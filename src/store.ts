import { useSyncExternalStore } from 'react';
import type {
  Comprobante,
  Copropiedad,
  CuentaPuc,
  EstadoApp,
  EventoAuditoria,
  Linea,
  PreAsiento,
} from './domain/types';
import { PERIODOS_CERRADOS, buildSeed } from './domain/seed';
import { CUENTAS, CUENTA_MAP } from './domain/puc';
import {
  cartera,
  lineasCierre,
  previewCierre,
  proximoConsecutivo,
  validarAsiento,
} from './domain/engine';
import { fmtPeriodo, ultimoDia } from './domain/format';
import {
  apiEnabled,
  approvePreEntryApi,
  billPeriodApi,
  changePasswordApi,
  closePeriodApi,
  createCompanyApi,
  createEntryApi,
  createPreEntryApi,
  createPucAccountApi,
  createThirdPartyApi,
  createUnitApi,
  createUserApi,
  fetchBootstrap,
  fetchPucApi,
  getAuthToken,
  loginApi,
  openNextPeriodApi,
  rejectPreEntryApi,
  resetRemote,
  setAuthToken,
  updateCompanySettingsApi,
  updatePreEntryLinesApi,
  updateRubroBudgetApi,
  updateThirdPartyApi,
  updateUnitApi,
  voidEntryApi,
  type AuthUser,
  type BackendLedgerAccount,
  type CreateCompanyPayload,
  type CreateEntryPayload,
  type CreatePreEntryPayload,
  type CreatePucPayload,
  type CreateUserPayload,
  type UpsertThirdPartyPayload,
  type UpsertUnitPayload,
  type UserRole,
} from './api';

const BASE_PUC_CODES = new Set(CUENTAS.map((c) => c.codigo));

const KEY = 'vertika.estado.v4';
const DATOS_KEY = 'vertika.datos.v1';
const AUTH_KEY = 'vertika.auth.v1';
const PUC_KEY = 'vertika.puc.v1';
const VERSION = 4;

export type Permiso = 'contabilidad' | 'maestros' | 'lectura';

export const DEMO_PERFILES: Array<{
  rol: UserRole;
  nombre: string;
  email: string;
  etiqueta: string;
  descripcion: string;
}> = [
  {
    rol: 'CONTADOR',
    nombre: 'Lina Castro',
    email: 'contador@vertika.co',
    etiqueta: 'Contador público',
    descripcion: 'Asentar comprobantes, anular, cerrar periodos, abrir periodos y editar maestros.',
  },
  {
    rol: 'ADMINISTRADOR',
    nombre: 'Carlos Mendoza',
    email: 'admin@vertika.co',
    etiqueta: 'Administrador PH',
    descripcion: 'Causar expensas del mes, gestionar unidades, terceros, presupuesto y parámetros.',
  },
  {
    rol: 'REVISOR_FISCAL',
    nombre: 'Marta Lucía Peña',
    email: 'revisor@vertika.co',
    etiqueta: 'Revisor fiscal',
    descripcion: 'Auditoría y lectura completa de libros, balances y comprobantes (solo lectura).',
  },
  {
    rol: 'CONSEJO',
    nombre: 'Andrea Gómez',
    email: 'consejo@vertika.co',
    etiqueta: 'Consejo de administración',
    descripcion: 'Consulta de ejecución presupuestal, cartera y estados financieros (solo lectura).',
  },
];

export function tienePermiso(rol: UserRole | undefined, permiso: Permiso): boolean {
  if (rol === 'SUPER_ADMIN') return true;
  if (permiso === 'lectura') return true;
  if (permiso === 'contabilidad') return rol === 'CONTADOR';
  return rol === 'CONTADOR' || rol === 'ADMINISTRADOR';
}

export interface AuthSession {
  user: AuthUser;
  token: string | null;
}

function defaultAuthSession(): AuthSession {
  return {
    user: {
      id: 'usr-contador',
      email: 'contador@vertika.co',
      nombre: 'Lina Castro',
      rol: 'CONTADOR',
    },
    token: getAuthToken(),
  };
}

function loadAuthSession(): AuthSession {
  try {
    if (typeof localStorage === 'undefined') return defaultAuthSession();
    const raw = localStorage.getItem(AUTH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AuthUser;
      if (parsed && parsed.rol && parsed.nombre) {
        return { user: parsed, token: getAuthToken() };
      }
    }
  } catch {
    // Usar perfil demo
  }
  return defaultAuthSession();
}

let authSession: AuthSession = loadAuthSession();
const authListeners = new Set<() => void>();

function setAuthSession(user: AuthUser, token: string | null) {
  setAuthToken(token);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(AUTH_KEY, JSON.stringify(user));
  } catch {
    // Storage no disponible
  }
  authSession = { user, token };
  authListeners.forEach((l) => l());
}

export function useAuth(): AuthSession {
  return useSyncExternalStore(
    (l) => {
      authListeners.add(l);
      return () => authListeners.delete(l);
    },
    () => authSession,
    () => authSession,
  );
}

function registerCuentaPuc(acc: CuentaPuc) {
  if (CUENTA_MAP[acc.codigo]) return;
  CUENTAS.push(acc);
  CUENTA_MAP[acc.codigo] = acc;
}

function mapBackendAccount(a: BackendLedgerAccount): CuentaPuc {
  return {
    codigo: a.code,
    nombre: a.name,
    tipo: a.account_type,
    naturaleza: a.nature,
    rubroKey: a.rubric_key ?? undefined,
    requiereTercero: a.requires_third_party,
    requiereUnidad: a.requires_unit,
    esEfectivo: a.is_cash,
    restringida: a.restricted,
    nota: a.note ?? undefined,
  };
}

function loadCustomPucLocal() {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(PUC_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw) as CuentaPuc[];
    if (Array.isArray(arr)) arr.forEach(registerCuentaPuc);
  } catch {
    // Ignorar PUC local corrupto
  }
}

function resetCustomPucMemory() {
  for (let i = CUENTAS.length - 1; i >= 0; i--) {
    const code = CUENTAS[i].codigo;
    if (!BASE_PUC_CODES.has(code)) {
      CUENTAS.splice(i, 1);
      delete CUENTA_MAP[code];
    }
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(PUC_KEY);
  } catch {
    // Ignorar
  }
}

loadCustomPucLocal();

function loadDatos(): ReturnType<typeof buildSeed> {
  const base = buildSeed();
  if (apiEnabled) return base;
  try {
    if (typeof localStorage === 'undefined') return base;
    const raw = localStorage.getItem(DATOS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ReturnType<typeof buildSeed>>;
      if (Array.isArray(parsed.companies) && Array.isArray(parsed.units) && Array.isArray(parsed.terceros) && Array.isArray(parsed.rubros)) {
        return {
          ...base,
          companies: parsed.companies,
          units: parsed.units,
          terceros: parsed.terceros,
          rubros: parsed.rubros,
        };
      }
    }
  } catch {
    // Ignorar
  }
  return base;
}

export let DATOS = loadDatos();

function saveDatosLocal() {
  if (apiEnabled) return;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        DATOS_KEY,
        JSON.stringify({
          companies: DATOS.companies,
          units: DATOS.units,
          terceros: DATOS.terceros,
          rubros: DATOS.rubros,
        }),
      );
    }
  } catch {
    // Ignorar
  }
}

export interface SyncStatus {
  mode: 'local' | 'demo-memory' | 'postgres';
  syncing: boolean;
  lastError: string | null;
}

let syncStatus: SyncStatus = {
  mode: apiEnabled ? 'demo-memory' : 'local',
  syncing: false,
  lastError: null,
};
const syncListeners = new Set<() => void>();

function setSyncStatus(patch: Partial<SyncStatus>) {
  syncStatus = { ...syncStatus, ...patch };
  syncListeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      syncListeners.add(l);
      return () => syncListeners.delete(l);
    },
    () => syncStatus,
    () => syncStatus,
  );
}

function estadoInicial(): EstadoApp {
  return {
    version: VERSION,
    activeCompanyId: DATOS.companies[0].id,
    periodo: DATOS.companies[0].periodoActual,
    preAsientos: DATOS.preAsientos,
    comprobantes: DATOS.comprobantes,
    periodosCerrados: PERIODOS_CERRADOS,
    auditoria: [
      {
        id: 'aud-0',
        ts: '2026-10-31T18:00:00.000Z',
        actor: 'Sistema',
        accion: 'Cierre contable',
        detalle: 'Periodo 2026-10 cerrado con depreciación, provisión y traslado de fondo.',
        empresaId: DATOS.companies[0].id,
      },
    ],
  };
}

function cargar(): EstadoApp {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as EstadoApp;
      if (parsed.version === VERSION && Array.isArray(parsed.comprobantes)) return parsed;
    }
  } catch {
    // Estado corrupto: se regenera la demo.
  }
  return estadoInicial();
}

let state = cargar();
const listeners = new Set<() => void>();

function persistLocal(next: EstadoApp) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Almacenamiento no disponible: se continúa en memoria.
  }
}

function commitLocal(next: EstadoApp) {
  state = next;
  persistLocal(next);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useEstado(): EstadoApp {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function getEstado(): EstadoApp {
  return state;
}

export function empresaActiva(estado: EstadoApp) {
  return DATOS.companies.find((c) => c.id === estado.activeCompanyId) ?? DATOS.companies[0];
}

export function unidadesDe(estado: EstadoApp) {
  return DATOS.units.filter((u) => u.empresaId === estado.activeCompanyId);
}

export function rubrosDe(estado: EstadoApp) {
  return DATOS.rubros.filter((r) => r.empresaId === estado.activeCompanyId);
}

export function tercerosDe(estado: EstadoApp) {
  return DATOS.terceros.filter((t) => !t.empresaId || t.empresaId === estado.activeCompanyId);
}

export function esPeriodoBloqueado(estado: EstadoApp, periodo: string): boolean {
  const cerrados = estado.periodosCerrados[estado.activeCompanyId] ?? [];
  if (cerrados.includes(periodo)) return true;
  const actual = empresaActiva(estado).periodoActual;
  return periodo > actual;
}

export function evento(actor: string, accion: string, detalle: string, empresaId?: string): EventoAuditoria {
  return {
    id: `aud-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    ts: new Date().toISOString(),
    actor,
    accion,
    detalle,
    empresaId: empresaId ?? state.activeCompanyId,
  };
}

export interface Resultado {
  ok: boolean;
  error?: string;
  comprobante?: Comprobante;
  detalle?: string;
}

function origenDe(pre: PreAsiento): Comprobante['origen'] {
  if (pre.agente.includes('OCR')) return 'AGENTE_IA_OCR';
  if (pre.agente.includes('DIAN')) return 'AGENTE_IA_DIAN';
  if (pre.agente.includes('CONCILIADOR')) return 'WEBHOOK_NFC';
  if (pre.agente.includes('CIERRE')) return 'CIERRE_AUTOMATICO';
  return 'CONTADOR_MANUAL';
}

function hashDe(comp: Omit<Comprobante, 'hash'>): string {
  const base = JSON.stringify([
    comp.tipo,
    comp.consecutivo,
    comp.fecha,
    comp.lineas.map((l) => [l.cuenta, l.debito, l.credito]),
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const actorActual = () => `${authSession.user.nombre} (${authSession.user.rol})`;

function nextPeriodString(p: string): string {
  const [y, m] = p.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export const acciones = {
  async iniciarSesion(email: string, password: string): Promise<Resultado> {
    if (apiEnabled) {
      setSyncStatus({ syncing: true, lastError: null });
      try {
        const res = await loginApi(email, password);
        setAuthSession(res.user, res.token);
        setSyncStatus({ syncing: false, lastError: null });
        return { ok: true, detalle: `${res.user.nombre} · ${res.user.rol}` };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Credenciales inválidas.';
        setSyncStatus({ syncing: false, lastError: msg });
        return { ok: false, error: msg };
      }
    }
    const perfil = DEMO_PERFILES.find((p) => p.email.toLowerCase() === email.trim().toLowerCase());
    if (!perfil || password !== 'vertika2026') {
      return { ok: false, error: 'Credenciales demo inválidas (clave: vertika2026).' };
    }
    setAuthSession(
      { id: `usr-${perfil.rol.toLowerCase()}`, email: perfil.email, nombre: perfil.nombre, rol: perfil.rol },
      null,
    );
    return { ok: true, detalle: `${perfil.nombre} · ${perfil.rol}` };
  },

  async cambiarRolDemo(rol: UserRole): Promise<Resultado> {
    const perfil = DEMO_PERFILES.find((p) => p.rol === rol);
    if (!perfil) return { ok: false, error: 'Rol no reconocido.' };
    if (apiEnabled) {
      return this.iniciarSesion(perfil.email, 'vertika2026');
    }
    setAuthSession(
      { id: `usr-${rol.toLowerCase()}`, email: perfil.email, nombre: perfil.nombre, rol: perfil.rol },
      null,
    );
    return { ok: true, detalle: `${perfil.nombre} · ${perfil.rol}` };
  },

  cerrarSesion() {
    const def = defaultAuthSession();
    setAuthSession(def.user, null);
  },

  async cambiarPassword(currentPassword: string, newPassword: string): Promise<Resultado> {
    if (!apiEnabled) {
      return {
        ok: false,
        error: 'El cambio de contraseña requiere conectar la consola al backend Rust (VITE_API_URL).',
      };
    }
    if (!authSession.token) {
      return {
        ok: false,
        error: 'Inicia sesión con correo y contraseña para obtener un token JWT antes de cambiar tu clave.',
      };
    }
    setSyncStatus({ syncing: true, lastError: null });
    try {
      await changePasswordApi(currentPassword, newPassword);
      setSyncStatus({ syncing: false, lastError: null });
      return { ok: true, detalle: 'Contraseña actualizada correctamente.' };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'No se pudo actualizar la contraseña.';
      setSyncStatus({ syncing: false, lastError: msg });
      return { ok: false, error: msg };
    }
  },

  async crearUsuario(payload: CreateUserPayload): Promise<Resultado> {
    if (!apiEnabled) {
      return {
        ok: false,
        error: 'El alta de usuarios requiere conectar la consola al backend Rust (VITE_API_URL).',
      };
    }
    if (!tienePermiso(authSession.user.rol, 'maestros')) {
      return {
        ok: false,
        error: `El rol ${authSession.user.rol} no puede crear usuarios.`,
      };
    }
    setSyncStatus({ syncing: true, lastError: null });
    try {
      const res = await createUserApi(payload);
      setSyncStatus({ syncing: false, lastError: null });
      return { ok: true, detalle: `${res.user.nombre} (${res.user.rol})` };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'No se pudo crear el usuario.';
      setSyncStatus({ syncing: false, lastError: msg });
      return { ok: false, error: msg };
    }
  },

  async crearCopropiedad(payload: CreateCompanyPayload): Promise<Resultado> {
    if (!apiEnabled) {
      return {
        ok: false,
        error: 'Crear copropiedades requiere conectar la consola al backend Rust (VITE_API_URL).',
      };
    }
    if (!tienePermiso(authSession.user.rol, 'contabilidad')) {
      return {
        ok: false,
        error: 'Solo un Contador o Super Admin puede crear nuevas copropiedades.',
      };
    }
    setSyncStatus({ syncing: true, lastError: null });
    try {
      const res = await createCompanyApi(payload);
      setAuthSession(res.user, res.token);
      await acciones.sincronizar();
      const creada = DATOS.companies.find((c) => c.id === res.copropiedad.id) ?? res.copropiedad;
      commitLocal({
        ...state,
        activeCompanyId: creada.id,
        periodo: creada.periodoActual,
      });
      setSyncStatus({ syncing: false, lastError: null });
      return { ok: true, detalle: `${creada.nombreCorto} (${creada.nit})` };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'No se pudo crear la copropiedad.';
      setSyncStatus({ syncing: false, lastError: msg });
      return { ok: false, error: msg };
    }
  },

  cambiarEmpresa(id: string) {
    const empresa = DATOS.companies.find((c) => c.id === id);
    if (!empresa) return;
    commitLocal({ ...state, activeCompanyId: id, periodo: empresa.periodoActual });
  },

  cambiarPeriodo(periodo: string) {
    commitLocal({ ...state, periodo });
  },

  cambiarLineasPreAsiento(id: string, lineas: Linea[]) {
    commitLocal({
      ...state,
      preAsientos: state.preAsientos.map((p) => (p.id === id ? { ...p, lineas } : p)),
    });
    if (apiEnabled) {
      setSyncStatus({ syncing: true, lastError: null });
      void updatePreEntryLinesApi(id, lineas)
        .then(() => setSyncStatus({ syncing: false, lastError: null }))
        .catch((e: unknown) =>
          setSyncStatus({
            syncing: false,
            lastError: e instanceof Error ? e.message : 'Error sincronizando líneas',
          }),
        );
    }
  },

  async radicarPreAsiento(
    payload: CreatePreEntryPayload,
  ): Promise<Resultado & { preAsiento?: PreAsiento }> {
    if (!tienePermiso(authSession.user.rol, 'maestros')) {
      return {
        ok: false,
        error: `El rol ${authSession.user.rol} no puede radicar facturas en la Bandeja.`,
      };
    }
    const valid = validarAsiento(payload.lines);
    if (!valid.ok) {
      return { ok: false, error: valid.errores[0] ?? 'El pre-asiento no cuadra.' };
    }
    if (apiEnabled) {
      setSyncStatus({ syncing: true, lastError: null });
      try {
        const res = await createPreEntryApi(payload);
        commitLocal({
          ...state,
          preAsientos: [res.preAsiento, ...state.preAsientos],
          auditoria: [res.auditoria, ...state.auditoria].slice(0, 200),
        });
        setSyncStatus({ syncing: false, lastError: null });
        return {
          ok: true,
          preAsiento: res.preAsiento,
          detalle: `${res.preAsiento.documento.numero} radicada en Bandeja`,
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'No se pudo radicar la factura.';
        setSyncStatus({ syncing: false, lastError: msg });
        return { ok: false, error: msg };
      }
    }

    if (esPeriodoBloqueado(state, payload.period)) {
      return {
        ok: false,
        error: `El periodo ${fmtPeriodo(payload.period)} está cerrado o aún no está abierto.`,
      };
    }
    const id = `pre-xml-${Date.now()}`;
    const doc = payload.document ?? {
      clase: payload.entryType === 'DS' ? ('SOPORTE' as const) : ('FACTURA' as const),
      numero: `FE-${Date.now().toString().slice(-4)}`,
      emisor: DATOS.terceros.find((t) => t.id === payload.terceroId)?.nombre ?? 'Proveedor',
      nit: DATOS.terceros.find((t) => t.id === payload.terceroId)?.documento ?? '',
      fecha: payload.date,
      items: [{ descripcion: payload.description, cantidad: 1, valorUnitario: valid.totalDebito }],
      subtotal: valid.totalDebito,
      iva: 0,
      total: valid.totalDebito,
      retenciones: [],
    };
    const nuevo: PreAsiento = {
      id,
      empresaId: payload.companyId,
      periodo: payload.period,
      tipo: payload.entryType,
      fecha: payload.date,
      agente: payload.agent ?? 'AGENTE_IA_DIAN',
      confianza: payload.confianza ?? 96.5,
      terceroId: payload.terceroId,
      unidadId: payload.unidadId,
      rubroId: payload.rubroId,
      descripcion: payload.description,
      documento: doc,
      lineas: payload.lines,
      estado: 'PENDIENTE',
      notas: payload.notes ?? ['Factura radicada desde carga XML / manual'],
    };
    const ev = evento(
      actorActual(),
      'Radicó factura en Bandeja',
      `${doc.numero} · ${payload.description}`,
      payload.companyId,
    );
    commitLocal({
      ...state,
      preAsientos: [nuevo, ...state.preAsientos],
      auditoria: [ev, ...state.auditoria].slice(0, 200),
    });
    return { ok: true, preAsiento: nuevo, detalle: `${doc.numero} radicada en Bandeja` };
  },

  async aprobarPreAsiento(id: string): Promise<Resultado> {
    if (!tienePermiso(authSession.user.rol, 'contabilidad')) {
      return { ok: false, error: `El rol ${authSession.user.rol} no puede asentar comprobantes.` };
    }
    if (apiEnabled) {
      setSyncStatus({ syncing: true, lastError: null });
      try {
        const res = await approvePreEntryApi(id);
        commitLocal({
          ...state,
          comprobantes: [...state.comprobantes, res.comprobante],
          preAsientos: state.preAsientos.filter((p) => p.id !== res.preAsientoId),
          auditoria: [res.auditoria, ...state.auditoria].slice(0, 200),
        });
        setSyncStatus({ syncing: false, lastError: null });
        return {
          ok: true,
          comprobante: res.comprobante,
          detalle: `${res.comprobante.tipo}-${res.comprobante.consecutivo}`,
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'No se pudo asentar en el servidor.';
        setSyncStatus({ syncing: false, lastError: msg });
        return { ok: false, error: msg };
      }
    }

    const pre = state.preAsientos.find((p) => p.id === id);
    if (!pre) return { ok: false, error: 'El pre-asiento ya no existe.' };
    if (esPeriodoBloqueado(state, pre.periodo)) {
      return { ok: false, error: `El periodo ${fmtPeriodo(pre.periodo)} está cerrado o aún no está abierto.` };
    }
    const valid = validarAsiento(pre.lineas);
    if (!valid.ok) return { ok: false, error: valid.errores[0] ?? 'El asiento no es válido.' };

    const consecutivo = proximoConsecutivo(state.comprobantes, pre.empresaId, pre.tipo);
    const base: Omit<Comprobante, 'hash'> = {
      id: `${pre.empresaId}-${pre.tipo}-${consecutivo}`,
      empresaId: pre.empresaId,
      periodo: pre.periodo,
      tipo: pre.tipo,
      consecutivo,
      fecha: pre.fecha,
      estado: 'ASENTADO',
      origen: origenDe(pre),
      descripcion: pre.descripcion,
      lineas: pre.lineas,
      totalDebito: valid.totalDebito,
      totalCredito: valid.totalCredito,
      referencia: pre.documento.numero,
      creadoPor: actorActual(),
      createdAt: new Date().toISOString(),
    };
    const comp: Comprobante = { ...base, hash: hashDe(base) };
    const ev = evento(actorActual(), 'Aprobó pre-asiento IA', `${pre.tipo}-${consecutivo} · ${pre.descripcion}`);
    commitLocal({
      ...state,
      comprobantes: [...state.comprobantes, comp],
      preAsientos: state.preAsientos.filter((p) => p.id !== id),
      auditoria: [ev, ...state.auditoria].slice(0, 200),
    });
    return { ok: true, comprobante: comp, detalle: `${pre.tipo}-${consecutivo}` };
  },

  async rechazarPreAsiento(id: string): Promise<Resultado> {
    if (!tienePermiso(authSession.user.rol, 'contabilidad')) {
      return { ok: false, error: `El rol ${authSession.user.rol} no puede devolver pre-asientos.` };
    }
    if (apiEnabled) {
      setSyncStatus({ syncing: true, lastError: null });
      try {
        const res = await rejectPreEntryApi(id);
        commitLocal({
          ...state,
          preAsientos: state.preAsientos.filter((p) => p.id !== id),
          auditoria: [res.auditoria, ...state.auditoria].slice(0, 200),
        });
        setSyncStatus({ syncing: false, lastError: null });
        return { ok: true };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'No se pudo devolver el pre-asiento.';
        setSyncStatus({ syncing: false, lastError: msg });
        return { ok: false, error: msg };
      }
    }

    const pre = state.preAsientos.find((p) => p.id === id);
    if (!pre) return { ok: false, error: 'El pre-asiento ya no existe.' };
    const ev = evento(actorActual(), 'Devolvió pre-asiento al agente', pre.descripcion);
    commitLocal({
      ...state,
      preAsientos: state.preAsientos.filter((p) => p.id !== id),
      auditoria: [ev, ...state.auditoria].slice(0, 200),
    });
    return { ok: true };
  },

  async crearComprobanteManual(payload: CreateEntryPayload): Promise<Resultado> {
    if (!tienePermiso(authSession.user.rol, 'contabilidad')) {
      return { ok: false, error: `El rol ${authSession.user.rol} no puede asentar comprobantes.` };
    }
    if (apiEnabled) {
      setSyncStatus({ syncing: true, lastError: null });
      try {
        const res = await createEntryApi(payload);
        commitLocal({
          ...state,
          comprobantes: [...state.comprobantes, res.comprobante],
          auditoria: [res.auditoria, ...state.auditoria].slice(0, 200),
        });
        setSyncStatus({ syncing: false, lastError: null });
        return {
          ok: true,
          comprobante: res.comprobante,
          detalle: `${res.comprobante.tipo}-${res.comprobante.consecutivo}`,
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'No se pudo asentar el comprobante.';
        setSyncStatus({ syncing: false, lastError: msg });
        return { ok: false, error: msg };
      }
    }

    if (esPeriodoBloqueado(state, payload.period)) {
      return { ok: false, error: `El periodo ${fmtPeriodo(payload.period)} está cerrado o sin abrir.` };
    }
    const valid = validarAsiento(payload.lines);
    if (!valid.ok) return { ok: false, error: valid.errores[0] ?? 'El asiento no es válido.' };

    const tipo = payload.entryType as Comprobante['tipo'];
    const consecutivo = proximoConsecutivo(state.comprobantes, payload.companyId, tipo);
    const id = `${payload.companyId}-${tipo}-${consecutivo}`;
    const lineas = payload.lines.map((l, idx) => ({
      ...l,
      id: l.id || `${id}-${idx + 1}`,
    }));
    const base: Omit<Comprobante, 'hash'> = {
      id,
      empresaId: payload.companyId,
      periodo: payload.period,
      tipo,
      consecutivo,
      fecha: payload.date,
      estado: 'ASENTADO',
      origen: 'CONTADOR_MANUAL',
      descripcion: payload.description,
      lineas,
      totalDebito: valid.totalDebito,
      totalCredito: valid.totalCredito,
      referencia: payload.reference || undefined,
      creadoPor: actorActual(),
      createdAt: new Date().toISOString(),
    };
    const comp: Comprobante = { ...base, hash: hashDe(base) };
    const ev = evento(
      actorActual(),
      'Asentó comprobante',
      `${comp.tipo}-${comp.consecutivo} · ${payload.description}`,
      payload.companyId,
    );
    commitLocal({
      ...state,
      comprobantes: [...state.comprobantes, comp],
      auditoria: [ev, ...state.auditoria].slice(0, 200),
    });
    return { ok: true, comprobante: comp, detalle: `${comp.tipo}-${comp.consecutivo}` };
  },

  async anularComprobante(id: string, motivo?: string): Promise<Resultado> {
    if (!tienePermiso(authSession.user.rol, 'contabilidad')) {
      return { ok: false, error: `El rol ${authSession.user.rol} no puede anular comprobantes.` };
    }
    if (apiEnabled) {
      setSyncStatus({ syncing: true, lastError: null });
      try {
        const res = await voidEntryApi(id, motivo);
        commitLocal({
          ...state,
          comprobantes: [
            ...state.comprobantes.map((c) => (c.id === res.anulado.id ? res.anulado : c)),
            res.reverso,
          ],
          auditoria: [res.auditoria, ...state.auditoria].slice(0, 200),
        });
        setSyncStatus({ syncing: false, lastError: null });
        return {
          ok: true,
          comprobante: res.reverso,
          detalle: `${res.reverso.tipo}-${res.reverso.consecutivo}`,
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'No se pudo anular el comprobante.';
        setSyncStatus({ syncing: false, lastError: msg });
        return { ok: false, error: msg };
      }
    }

    const orig = state.comprobantes.find((c) => c.id === id);
    if (!orig) return { ok: false, error: 'El comprobante no existe.' };
    if (orig.estado === 'ANULADO') return { ok: false, error: 'El comprobante ya fue anulado.' };
    if (esPeriodoBloqueado(state, orig.periodo)) {
      return { ok: false, error: `El periodo ${fmtPeriodo(orig.periodo)} está cerrado.` };
    }

    const consecutivo = proximoConsecutivo(state.comprobantes, orig.empresaId, 'NC');
    const revId = `${orig.empresaId}-NC-${consecutivo}`;
    const revLineas: Linea[] = orig.lineas.map((l, idx) => ({
      ...l,
      id: `${revId}-${idx + 1}`,
      descripcion: `Reverso: ${l.descripcion}`,
      debito: l.credito,
      credito: l.debito,
    }));
    const valid = validarAsiento(revLineas);
    if (!valid.ok) return { ok: false, error: valid.errores[0] ?? 'El reverso no cuadra.' };

    const motivoTxt = motivo?.trim() || 'Anulación solicitada por el contador';
    const base: Omit<Comprobante, 'hash'> = {
      id: revId,
      empresaId: orig.empresaId,
      periodo: orig.periodo,
      tipo: 'NC',
      consecutivo,
      fecha: orig.fecha,
      estado: 'ASENTADO',
      origen: 'CONTADOR_MANUAL',
      descripcion: `Anulación ${orig.tipo}-${orig.consecutivo}: ${motivoTxt}`,
      lineas: revLineas,
      totalDebito: valid.totalDebito,
      totalCredito: valid.totalCredito,
      referencia: `${orig.tipo}-${orig.consecutivo}`,
      creadoPor: actorActual(),
      createdAt: new Date().toISOString(),
    };
    const reverso: Comprobante = { ...base, hash: hashDe(base) };
    const ev = evento(
      actorActual(),
      'Anuló comprobante',
      `${orig.tipo}-${orig.consecutivo} anulado con reverso NC-${consecutivo} (${motivoTxt})`,
      orig.empresaId,
    );
    commitLocal({
      ...state,
      comprobantes: [
        ...state.comprobantes.map((c) => (c.id === orig.id ? { ...c, estado: 'ANULADO' as const } : c)),
        reverso,
      ],
      auditoria: [ev, ...state.auditoria].slice(0, 200),
    });
    return { ok: true, comprobante: reverso, detalle: `NC-${consecutivo}` };
  },

  async causarExpensasMes(periodo: string, incluirMora: boolean): Promise<Resultado> {
    if (!tienePermiso(authSession.user.rol, 'maestros')) {
      return { ok: false, error: `El rol ${authSession.user.rol} no puede causar expensas.` };
    }
    const empresa = empresaActiva(state);
    if (apiEnabled) {
      setSyncStatus({ syncing: true, lastError: null });
      try {
        const res = await billPeriodApi(empresa.id, periodo, incluirMora);
        commitLocal({
          ...state,
          comprobantes: [...state.comprobantes, res.comprobante],
          auditoria: [res.auditoria, ...state.auditoria].slice(0, 200),
        });
        setSyncStatus({ syncing: false, lastError: null });
        return {
          ok: true,
          comprobante: res.comprobante,
          detalle: `${res.comprobante.tipo}-${res.comprobante.consecutivo} · ${res.unidadesFacturadas} unidades`,
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'No se pudo causar el periodo.';
        setSyncStatus({ syncing: false, lastError: msg });
        return { ok: false, error: msg };
      }
    }

    if (esPeriodoBloqueado(state, periodo)) {
      return { ok: false, error: `El periodo ${fmtPeriodo(periodo)} está cerrado o sin abrir.` };
    }
    const yaCausado = state.comprobantes.some(
      (c) =>
        c.empresaId === empresa.id &&
        c.periodo === periodo &&
        c.estado !== 'ANULADO' &&
        c.tipo === 'CC' &&
        (c.origen === 'AGENTE_IA_LIQUIDADOR' || c.descripcion.startsWith('Liquidación masiva de expensas')),
    );
    if (yaCausado) {
      return { ok: false, error: `El periodo ${fmtPeriodo(periodo)} ya tiene causación masiva de expensas.` };
    }

    const units = unidadesDe(state);
    if (units.length === 0) return { ok: false, error: 'No hay unidades registradas.' };
    const round100 = (n: number) => Math.round(n / 100) * 100;
    const cuotaGlobal = empresa.presupuestoAnual / 12;
    const consecutivo = proximoConsecutivo(state.comprobantes, empresa.id, 'CC');
    const compId = `${empresa.id}-CC-${consecutivo}`;
    const lineas: Linea[] = [];
    let totalExp = 0;

    units.forEach((u, i) => {
      const cuota = round100((cuotaGlobal * u.coeficiente) / 100);
      if (cuota <= 0) return;
      totalExp += cuota;
      lineas.push({
        id: `${compId}-${i + 1}`,
        cuenta: '130505',
        descripcion: `Expensa ordinaria ${u.torre} ${u.numero}`,
        debito: cuota,
        credito: 0,
        unidadId: u.id,
        terceroId: u.arrendatarioId || u.propietarioId,
      });
    });

    if (totalExp <= 0) return { ok: false, error: 'El total calculado de expensas es cero.' };
    const fondo = round100((totalExp * empresa.fondoImprevistosPct) / 100);
    const ingreso = totalExp - fondo;
    if (ingreso > 0) {
      lineas.push({
        id: `${compId}-ing`,
        cuenta: '417005',
        descripcion: 'Causación expensas ordinarias del mes',
        debito: 0,
        credito: ingreso,
      });
    }
    if (fondo > 0) {
      lineas.push({
        id: `${compId}-fdo`,
        cuenta: '281510',
        descripcion: 'Apropiación fondo de imprevistos Ley 675',
        debito: 0,
        credito: fondo,
      });
    }

    if (incluirMora && empresa.tasaMoraMensual > 0) {
      const prevRows = cartera(
        state.comprobantes.filter((c) => c.periodo < periodo),
        empresa,
        units,
        DATOS.terceros,
        periodo,
      );
      let totalMora = 0;
      prevRows.forEach((f, idx) => {
        if (f.unidad.carteraCongelada || f.saldo <= 0) return;
        const mora = round100((f.saldo * empresa.tasaMoraMensual) / 100);
        if (mora <= 0) return;
        totalMora += mora;
        lineas.push({
          id: `${compId}-m-${idx + 1}`,
          cuenta: '130515',
          descripcion: `Interés de mora ${f.unidad.torre} ${f.unidad.numero}`,
          debito: mora,
          credito: 0,
          unidadId: f.unidad.id,
          terceroId: f.unidad.arrendatarioId || f.unidad.propietarioId,
        });
      });
      if (totalMora > 0) {
        lineas.push({
          id: `${compId}-mora-ing`,
          cuenta: '417030',
          descripcion: 'Intereses de mora sobre cartera vencida',
          debito: 0,
          credito: totalMora,
        });
      }
    }

    const valid = validarAsiento(lineas);
    if (!valid.ok) return { ok: false, error: valid.errores[0] ?? 'La causación no cuadra.' };

    const base: Omit<Comprobante, 'hash'> = {
      id: compId,
      empresaId: empresa.id,
      periodo,
      tipo: 'CC',
      consecutivo,
      fecha: `${periodo}-01`,
      estado: 'ASENTADO',
      origen: 'AGENTE_IA_LIQUIDADOR',
      descripcion: `Liquidación masiva de expensas ${periodo}`,
      lineas,
      totalDebito: valid.totalDebito,
      totalCredito: valid.totalCredito,
      referencia: `EXP-${periodo}`,
      creadoPor: actorActual(),
      createdAt: new Date().toISOString(),
    };
    const comp: Comprobante = { ...base, hash: hashDe(base) };
    const ev = evento(
      actorActual(),
      'Causó expensas del periodo',
      `${comp.tipo}-${comp.consecutivo} · ${units.length} unidades (${periodo})`,
    );
    commitLocal({
      ...state,
      comprobantes: [...state.comprobantes, comp],
      auditoria: [ev, ...state.auditoria].slice(0, 200),
    });
    return { ok: true, comprobante: comp, detalle: `${comp.tipo}-${comp.consecutivo} · ${units.length} unidades` };
  },

  async abrirSiguientePeriodo(): Promise<Resultado> {
    if (!tienePermiso(authSession.user.rol, 'contabilidad')) {
      return { ok: false, error: `El rol ${authSession.user.rol} no puede abrir periodos.` };
    }
    const empresa = empresaActiva(state);
    if (apiEnabled) {
      setSyncStatus({ syncing: true, lastError: null });
      try {
        const res = await openNextPeriodApi(empresa.id);
        DATOS = {
          ...DATOS,
          companies: DATOS.companies.map((c) =>
            c.id === empresa.id ? { ...c, periodoActual: res.periodoNuevo } : c,
          ),
        };
        commitLocal({
          ...state,
          periodo: res.periodoNuevo,
          auditoria: [res.auditoria, ...state.auditoria].slice(0, 200),
        });
        setSyncStatus({ syncing: false, lastError: null });
        return { ok: true, detalle: `${res.periodoAnterior} → ${res.periodoNuevo}` };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'No se pudo abrir el siguiente periodo.';
        setSyncStatus({ syncing: false, lastError: msg });
        return { ok: false, error: msg };
      }
    }

    const cerrados = state.periodosCerrados[empresa.id] ?? [];
    if (!cerrados.includes(empresa.periodoActual)) {
      return { ok: false, error: `Debes cerrar ${fmtPeriodo(empresa.periodoActual)} antes de abrir el siguiente.` };
    }
    const anterior = empresa.periodoActual;
    const nuevo = nextPeriodString(anterior);
    DATOS = {
      ...DATOS,
      companies: DATOS.companies.map((c) => (c.id === empresa.id ? { ...c, periodoActual: nuevo } : c)),
    };
    saveDatosLocal();
    const ev = evento(actorActual(), 'Abrió nuevo periodo', `${anterior} → ${nuevo}`);
    commitLocal({
      ...state,
      periodo: nuevo,
      auditoria: [ev, ...state.auditoria].slice(0, 200),
    });
    return { ok: true, detalle: `${anterior} → ${nuevo}` };
  },

  async crearUnidad(payload: UpsertUnitPayload): Promise<Resultado> {
    if (!tienePermiso(authSession.user.rol, 'maestros')) {
      return { ok: false, error: `El rol ${authSession.user.rol} no puede editar maestros.` };
    }
    const empresa = empresaActiva(state);
    if (apiEnabled) {
      try {
        const unit = await createUnitApi(empresa.id, payload);
        DATOS = { ...DATOS, units: [...DATOS.units, unit] };
        commitLocal({ ...state });
        return { ok: true, detalle: `${unit.torre} ${unit.numero}` };
      } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : 'No se pudo crear la unidad.' };
      }
    }
    if (payload.coeficiente <= 0) return { ok: false, error: 'El coeficiente debe ser mayor a cero.' };
    const dup = DATOS.units.some(
      (u) =>
        u.empresaId === empresa.id &&
        u.torre.toLowerCase() === payload.torre.trim().toLowerCase() &&
        u.numero.toLowerCase() === payload.numero.trim().toLowerCase(),
    );
    if (dup) return { ok: false, error: 'Ya existe una unidad con esa torre y número.' };
    const unit = {
      id: `u-${Date.now().toString(36)}`,
      empresaId: empresa.id,
      ...payload,
      torre: payload.torre.trim(),
      numero: payload.numero.trim(),
      matricula: payload.matricula.trim(),
      arrendatarioId: payload.arrendatarioId || undefined,
    };
    DATOS = { ...DATOS, units: [...DATOS.units, unit] };
    saveDatosLocal();
    const ev = evento(actorActual(), 'Creó unidad', `${unit.torre} ${unit.numero}`);
    commitLocal({ ...state, auditoria: [ev, ...state.auditoria].slice(0, 200) });
    return { ok: true, detalle: `${unit.torre} ${unit.numero}` };
  },

  async actualizarUnidad(unitId: string, payload: UpsertUnitPayload): Promise<Resultado> {
    if (!tienePermiso(authSession.user.rol, 'maestros')) {
      return { ok: false, error: `El rol ${authSession.user.rol} no puede editar maestros.` };
    }
    const empresa = empresaActiva(state);
    if (apiEnabled) {
      try {
        const unit = await updateUnitApi(empresa.id, unitId, payload);
        DATOS = { ...DATOS, units: DATOS.units.map((u) => (u.id === unitId ? unit : u)) };
        commitLocal({ ...state });
        return { ok: true, detalle: `${unit.torre} ${unit.numero}` };
      } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : 'No se pudo actualizar la unidad.' };
      }
    }
    if (payload.coeficiente <= 0) return { ok: false, error: 'El coeficiente debe ser mayor a cero.' };
    DATOS = {
      ...DATOS,
      units: DATOS.units.map((u) =>
        u.id === unitId
          ? {
              ...u,
              ...payload,
              torre: payload.torre.trim(),
              numero: payload.numero.trim(),
              matricula: payload.matricula.trim(),
              arrendatarioId: payload.arrendatarioId || undefined,
            }
          : u,
      ),
    };
    saveDatosLocal();
    const ev = evento(actorActual(), 'Actualizó unidad', `${payload.torre} ${payload.numero}`);
    commitLocal({ ...state, auditoria: [ev, ...state.auditoria].slice(0, 200) });
    return { ok: true, detalle: `${payload.torre} ${payload.numero}` };
  },

  async crearTercero(payload: UpsertThirdPartyPayload): Promise<Resultado> {
    if (!tienePermiso(authSession.user.rol, 'maestros')) {
      return { ok: false, error: `El rol ${authSession.user.rol} no puede editar maestros.` };
    }
    const empresa = empresaActiva(state);
    if (apiEnabled) {
      try {
        const tp = await createThirdPartyApi(empresa.id, payload);
        DATOS = { ...DATOS, terceros: [...DATOS.terceros, tp] };
        commitLocal({ ...state });
        return { ok: true, detalle: tp.nombre };
      } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : 'No se pudo crear el tercero.' };
      }
    }
    if (!payload.nombre.trim() || !payload.documento.trim()) {
      return { ok: false, error: 'Nombre y documento son obligatorios.' };
    }
    const tp = {
      id: `tp-${Date.now().toString(36)}`,
      empresaId: empresa.id,
      ...payload,
      nombre: payload.nombre.trim(),
      documento: payload.documento.trim(),
      dv: payload.dv?.trim() || undefined,
    };
    DATOS = { ...DATOS, terceros: [...DATOS.terceros, tp] };
    saveDatosLocal();
    const ev = evento(actorActual(), 'Creó tercero', tp.nombre);
    commitLocal({ ...state, auditoria: [ev, ...state.auditoria].slice(0, 200) });
    return { ok: true, detalle: tp.nombre };
  },

  async actualizarTercero(tpId: string, payload: UpsertThirdPartyPayload): Promise<Resultado> {
    if (!tienePermiso(authSession.user.rol, 'maestros')) {
      return { ok: false, error: `El rol ${authSession.user.rol} no puede editar maestros.` };
    }
    const empresa = empresaActiva(state);
    if (apiEnabled) {
      try {
        const tp = await updateThirdPartyApi(empresa.id, tpId, payload);
        DATOS = { ...DATOS, terceros: DATOS.terceros.map((t) => (t.id === tpId ? tp : t)) };
        commitLocal({ ...state });
        return { ok: true, detalle: tp.nombre };
      } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : 'No se pudo actualizar el tercero.' };
      }
    }
    DATOS = {
      ...DATOS,
      terceros: DATOS.terceros.map((t) =>
        t.id === tpId
          ? {
              ...t,
              ...payload,
              nombre: payload.nombre.trim(),
              documento: payload.documento.trim(),
              dv: payload.dv?.trim() || undefined,
            }
          : t,
      ),
    };
    saveDatosLocal();
    const ev = evento(actorActual(), 'Actualizó tercero', payload.nombre.trim());
    commitLocal({ ...state, auditoria: [ev, ...state.auditoria].slice(0, 200) });
    return { ok: true, detalle: payload.nombre.trim() };
  },

  async crearCuentaPuc(payload: CreatePucPayload): Promise<Resultado> {
    if (!tienePermiso(authSession.user.rol, 'contabilidad')) {
      return { ok: false, error: `El rol ${authSession.user.rol} no puede crear cuentas PUC.` };
    }
    const empresa = empresaActiva(state);
    if (apiEnabled) {
      try {
        const acc = mapBackendAccount(await createPucAccountApi(empresa.id, payload));
        registerCuentaPuc(acc);
        commitLocal({ ...state });
        return { ok: true, detalle: `${acc.codigo} · ${acc.nombre}` };
      } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : 'No se pudo crear la cuenta.' };
      }
    }
    const codigo = payload.codigo.trim();
    const nombre = payload.nombre.trim();
    if (!codigo || !nombre) return { ok: false, error: 'Código y nombre son obligatorios.' };
    if (CUENTA_MAP[codigo]) return { ok: false, error: `La cuenta ${codigo} ya existe.` };
    const acc: CuentaPuc = {
      codigo,
      nombre,
      tipo: payload.tipo,
      naturaleza: payload.naturaleza,
      rubroKey: payload.rubroKey || undefined,
      requiereTercero: payload.requiereTercero,
      requiereUnidad: payload.requiereUnidad,
      esEfectivo: codigo.startsWith('11'),
      nota: payload.nota || undefined,
    };
    registerCuentaPuc(acc);
    try {
      const custom = CUENTAS.filter((c) => !BASE_PUC_CODES.has(c.codigo));
      if (typeof localStorage !== 'undefined') localStorage.setItem(PUC_KEY, JSON.stringify(custom));
    } catch {
      // Ignorar
    }
    const ev = evento(actorActual(), 'Creó cuenta PUC', `${acc.codigo} · ${acc.nombre}`);
    commitLocal({ ...state, auditoria: [ev, ...state.auditoria].slice(0, 200) });
    return { ok: true, detalle: `${acc.codigo} · ${acc.nombre}` };
  },

  async actualizarPresupuestoRubro(rubroId: string, presupuestoAnual: number): Promise<Resultado> {
    if (!tienePermiso(authSession.user.rol, 'maestros')) {
      return { ok: false, error: `El rol ${authSession.user.rol} no puede editar el presupuesto.` };
    }
    if (presupuestoAnual < 0 || !Number.isFinite(presupuestoAnual)) {
      return { ok: false, error: 'Presupuesto anual inválido.' };
    }
    const empresa = empresaActiva(state);
    if (apiEnabled) {
      try {
        const updated = await updateRubroBudgetApi(empresa.id, rubroId, presupuestoAnual);
        const rubros = DATOS.rubros.map((r) => (r.id === rubroId ? updated : r));
        const total = rubros
          .filter((r) => r.empresaId === empresa.id)
          .reduce((s, r) => s + r.presupuestoAnual, 0);
        DATOS = {
          ...DATOS,
          rubros,
          companies: DATOS.companies.map((c) =>
            c.id === empresa.id ? { ...c, presupuestoAnual: total } : c,
          ),
        };
        commitLocal({ ...state });
        return { ok: true, detalle: updated.nombre };
      } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : 'No se pudo actualizar el rubro.' };
      }
    }
    const rubros = DATOS.rubros.map((r) =>
      r.id === rubroId ? { ...r, presupuestoAnual } : r,
    );
    const total = rubros
      .filter((r) => r.empresaId === empresa.id)
      .reduce((s, r) => s + r.presupuestoAnual, 0);
    DATOS = {
      ...DATOS,
      rubros,
      companies: DATOS.companies.map((c) =>
        c.id === empresa.id ? { ...c, presupuestoAnual: total } : c,
      ),
    };
    saveDatosLocal();
    const rubroNom = rubros.find((r) => r.id === rubroId)?.nombre ?? rubroId;
    const ev = evento(actorActual(), 'Actualizó presupuesto', `${rubroNom}: $${presupuestoAnual}`);
    commitLocal({ ...state, auditoria: [ev, ...state.auditoria].slice(0, 200) });
    return { ok: true, detalle: rubroNom };
  },

  async actualizarParametrosEmpresa(
    patch: Partial<
      Pick<
        Copropiedad,
        | 'razonSocial'
        | 'direccion'
        | 'fondoImprevistosPct'
        | 'tasaMoraMensual'
        | 'diaCorteProntoPago'
        | 'descuentoProntoPagoPct'
        | 'llaveBreB'
      >
    >,
  ): Promise<Resultado> {
    if (!tienePermiso(authSession.user.rol, 'maestros')) {
      return { ok: false, error: `El rol ${authSession.user.rol} no puede editar parámetros.` };
    }
    const empresa = empresaActiva(state);
    if (apiEnabled) {
      try {
        const updated = await updateCompanySettingsApi(empresa.id, patch);
        DATOS = {
          ...DATOS,
          companies: DATOS.companies.map((c) => (c.id === empresa.id ? updated : c)),
        };
        commitLocal({ ...state });
        return { ok: true, detalle: updated.razonSocial };
      } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : 'No se pudieron guardar los ajustes.' };
      }
    }
    DATOS = {
      ...DATOS,
      companies: DATOS.companies.map((c) => (c.id === empresa.id ? { ...c, ...patch } : c)),
    };
    saveDatosLocal();
    const ev = evento(actorActual(), 'Actualizó parámetros', empresa.razonSocial);
    commitLocal({ ...state, auditoria: [ev, ...state.auditoria].slice(0, 200) });
    return { ok: true, detalle: empresa.razonSocial };
  },

  async ejecutarCierre(
    periodo: string,
    opciones?: { depreciacion: boolean; provision: boolean; traslado: boolean },
  ): Promise<Resultado> {
    if (!tienePermiso(authSession.user.rol, 'contabilidad')) {
      return { ok: false, error: `El rol ${authSession.user.rol} no puede ejecutar cierres.` };
    }
    const opts = opciones ?? { depreciacion: true, provision: true, traslado: true };
    const empresa = empresaActiva(state);

    if (apiEnabled) {
      setSyncStatus({ syncing: true, lastError: null });
      try {
        const res = await closePeriodApi(empresa.id, periodo, opts);
        const cerrados = state.periodosCerrados[empresa.id] ?? [];
        commitLocal({
          ...state,
          comprobantes: [...state.comprobantes, res.comprobante],
          periodosCerrados: {
            ...state.periodosCerrados,
            [empresa.id]: cerrados.includes(res.periodoCerrado)
              ? cerrados
              : [...cerrados, res.periodoCerrado],
          },
          auditoria: [res.auditoria, ...state.auditoria].slice(0, 200),
        });
        setSyncStatus({ syncing: false, lastError: null });
        return {
          ok: true,
          comprobante: res.comprobante,
          detalle: `${res.comprobante.tipo}-${res.comprobante.consecutivo}`,
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'No se pudo cerrar el periodo en el servidor.';
        setSyncStatus({ syncing: false, lastError: msg });
        return { ok: false, error: msg };
      }
    }

    if (esPeriodoBloqueado(state, periodo)) {
      return { ok: false, error: `El periodo ${fmtPeriodo(periodo)} ya está cerrado o no está abierto.` };
    }
    const preview = previewCierre(state.comprobantes, empresa, unidadesDe(state), DATOS.terceros, periodo);
    const rubros = rubrosDe(state);
    const lineas = lineasCierre(empresa, periodo, preview, rubros).filter((l) => {
      if (!opts.depreciacion && (l.cuenta === '516005' || l.cuenta === '159215')) return false;
      if (!opts.provision && (l.cuenta === '519905' || l.cuenta === '139905')) return false;
      if (!opts.traslado && (l.cuenta === '111010' || l.cuenta === '111005')) return false;
      return true;
    });
    if (lineas.length < 2) return { ok: false, error: 'Debe ejecutar al menos una operación de cierre.' };
    const valid = validarAsiento(lineas);
    if (!valid.ok) return { ok: false, error: valid.errores[0] ?? 'El cierre no cuadra.' };

    const consecutivo = proximoConsecutivo(state.comprobantes, empresa.id, 'NC');
    const base: Omit<Comprobante, 'hash'> = {
      id: `${empresa.id}-NC-${consecutivo}`,
      empresaId: empresa.id,
      periodo,
      tipo: 'NC',
      consecutivo,
      fecha: ultimoDia(periodo),
      estado: 'ASENTADO',
      origen: 'CIERRE_AUTOMATICO',
      descripcion: `Cierre contable ${periodo}`,
      lineas,
      totalDebito: valid.totalDebito,
      totalCredito: valid.totalCredito,
      creadoPor: actorActual(),
      createdAt: new Date().toISOString(),
    };
    const comp: Comprobante = { ...base, hash: hashDe(base) };
    const cerrados = state.periodosCerrados[empresa.id] ?? [];
    const ops: string[] = [];
    if (lineas.some((l) => l.cuenta === '516005')) ops.push('depreciación');
    if (lineas.some((l) => l.cuenta === '519905')) ops.push('provisión de cartera');
    if (lineas.some((l) => l.cuenta === '111010')) ops.push('traslado al fondo');
    const ev = evento(
      actorActual(),
      'Ejecutó cierre mensual',
      `${fmtPeriodo(periodo)}: ${ops.join(', ')}.`,
    );
    commitLocal({
      ...state,
      comprobantes: [...state.comprobantes, comp],
      periodosCerrados: { ...state.periodosCerrados, [empresa.id]: [...cerrados, periodo] },
      auditoria: [ev, ...state.auditoria].slice(0, 200),
    });
    return { ok: true, comprobante: comp, detalle: `${comp.tipo}-${comp.consecutivo}` };
  },

  async restablecer() {
    if (apiEnabled) {
      setSyncStatus({ syncing: true, lastError: null });
      try {
        const res: any = await resetRemote();
        if (res?.datos) DATOS = res.datos;
        else {
          const boot = await fetchBootstrap();
          DATOS = boot.datos ?? DATOS;
        }
        resetCustomPucMemory();
        const nextEstado = res?.estado ?? res;
        if (nextEstado) commitLocal(nextEstado);
        setSyncStatus({ syncing: false, lastError: null });
        return;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'No se pudo restablecer en backend';
        setSyncStatus({ syncing: false, lastError: msg });
        console.error('No se pudo restablecer en backend, usando local', e);
      }
    }
    resetCustomPucMemory();
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(DATOS_KEY);
    } catch {
      // Ignorar
    }
    DATOS = buildSeed();
    commitLocal(estadoInicial());
  },

  async sincronizar() {
    const prevCompany = state.activeCompanyId;
    const prevPeriodo = state.periodo;
    await bootstrapFromApi();
    if (DATOS.companies.some((c) => c.id === prevCompany)) {
      commitLocal({ ...state, activeCompanyId: prevCompany, periodo: prevPeriodo });
    }
  },
};

export function exportarEstado(): string {
  return JSON.stringify(state, null, 2);
}

export const API_MODE = apiEnabled;

async function bootstrapFromApi() {
  if (!apiEnabled) return;
  setSyncStatus({ syncing: true, lastError: null });
  try {
    const boot = await fetchBootstrap();
    if (boot?.datos) DATOS = boot.datos;
    const puc = await fetchPucApi().catch(() => []);
    puc.map(mapBackendAccount).forEach(registerCuentaPuc);
    if (boot?.estado) {
      commitLocal(boot.estado);
    }
    const mode = boot?.mode === 'postgres' ? 'postgres' : 'demo-memory';
    setSyncStatus({ mode, syncing: false, lastError: null });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Backend no disponible; operando en modo local.';
    setSyncStatus({ mode: 'local', syncing: false, lastError: msg });
    console.error('No se pudo cargar bootstrap desde backend; se usa modo local.', e);
  }
}

void bootstrapFromApi();
