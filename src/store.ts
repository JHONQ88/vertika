import { useSyncExternalStore } from 'react';
import type {
  Comprobante,
  EstadoApp,
  EventoAuditoria,
  Linea,
  PreAsiento,
} from './domain/types';
import { PERIODOS_CERRADOS, buildSeed } from './domain/seed';
import {
  lineasCierre,
  previewCierre,
  proximoConsecutivo,
  validarAsiento,
} from './domain/engine';
import { fmtPeriodo, ultimoDia } from './domain/format';
import { apiEnabled, fetchBootstrap, resetRemote, saveState } from './api';

export let DATOS = buildSeed();

const KEY = 'vertika.estado.v4';
const VERSION = 4;

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

function persist(next: EstadoApp) {
  persistLocal(next);
  if (apiEnabled) {
    void saveState(next).catch((e) => {
      // La UI sigue operando con estado local; se registra el fallo.
      console.error('No se pudo sincronizar con el backend', e);
    });
  }
}

function commit(next: EstadoApp) {
  state = next;
  persist(next);
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

export function evento(actor: string, accion: string, detalle: string): EventoAuditoria {
  return {
    id: `aud-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    ts: new Date().toISOString(),
    actor,
    accion,
    detalle,
    empresaId: state.activeCompanyId,
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

export const acciones = {
  cambiarEmpresa(id: string) {
    const empresa = DATOS.companies.find((c) => c.id === id);
    if (!empresa) return;
    commit({ ...state, activeCompanyId: id, periodo: empresa.periodoActual });
  },

  cambiarPeriodo(periodo: string) {
    commit({ ...state, periodo });
  },

  cambiarLineasPreAsiento(id: string, lineas: Linea[]) {
    commit({
      ...state,
      preAsientos: state.preAsientos.map((p) => (p.id === id ? { ...p, lineas } : p)),
    });
  },

  aprobarPreAsiento(id: string): Resultado {
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
      creadoPor: 'Contador demo',
      createdAt: new Date().toISOString(),
    };
    const comp: Comprobante = { ...base, hash: hashDe(base) };
    const ev = evento('Contador demo', 'Aprobó pre-asiento IA', `${pre.tipo}-${consecutivo} · ${pre.descripcion}`);
    commit({
      ...state,
      comprobantes: [...state.comprobantes, comp],
      preAsientos: state.preAsientos.filter((p) => p.id !== id),
      auditoria: [ev, ...state.auditoria].slice(0, 200),
    });
    return { ok: true, comprobante: comp, detalle: `${pre.tipo}-${consecutivo}` };
  },

  rechazarPreAsiento(id: string): Resultado {
    const pre = state.preAsientos.find((p) => p.id === id);
    if (!pre) return { ok: false, error: 'El pre-asiento ya no existe.' };
    const ev = evento('Contador demo', 'Devolvió pre-asiento al agente', pre.descripcion);
    commit({
      ...state,
      preAsientos: state.preAsientos.filter((p) => p.id !== id),
      auditoria: [ev, ...state.auditoria].slice(0, 200),
    });
    return { ok: true };
  },

  async ejecutarCierre(
    periodo: string,
    opciones?: { depreciacion: boolean; provision: boolean; traslado: boolean },
  ): Promise<Resultado> {
    const opts = opciones ?? { depreciacion: true, provision: true, traslado: true };
    const empresa = empresaActiva(state);
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
      creadoPor: 'Contador demo',
      createdAt: new Date().toISOString(),
    };
    const comp: Comprobante = { ...base, hash: hashDe(base) };
    const cerrados = state.periodosCerrados[empresa.id] ?? [];
    const ops: string[] = [];
    if (lineas.some((l) => l.cuenta === '516005')) ops.push('depreciación');
    if (lineas.some((l) => l.cuenta === '519905')) ops.push('provisión de cartera');
    if (lineas.some((l) => l.cuenta === '111010')) ops.push('traslado al fondo');
    const ev = evento(
      'Contador demo',
      'Ejecutó cierre mensual',
      `${fmtPeriodo(periodo)}: ${ops.join(', ')}.`,
    );
    commit({
      ...state,
      comprobantes: [...state.comprobantes, comp],
      periodosCerrados: { ...state.periodosCerrados, [empresa.id]: [...cerrados, periodo] },
      auditoria: [ev, ...state.auditoria].slice(0, 200),
    });
    return { ok: true, comprobante: comp, detalle: `${comp.tipo}-${comp.consecutivo}` };
  },

  async restablecer() {
    if (apiEnabled) {
      try {
        const res: any = await resetRemote();
        const nextEstado = res?.estado ?? res;
        DATOS = buildSeed();
        // refrescar masters desde bootstrap por si cambiaron
        const boot = await fetchBootstrap();
        DATOS = boot.datos ?? DATOS;
        state = nextEstado;
        persistLocal(state);
        listeners.forEach((l) => l());
        return;
      } catch (e) {
        console.error('No se pudo restablecer en backend, usando local', e);
      }
    }
    DATOS = buildSeed();
    commit(estadoInicial());
  },
};

export function exportarEstado(): string {
  return JSON.stringify(state, null, 2);
}

export const API_MODE = apiEnabled;

async function bootstrapFromApi() {
  if (!apiEnabled) return;
  try {
    const boot = await fetchBootstrap();
    if (boot?.datos) DATOS = boot.datos;
    if (boot?.estado) {
      state = boot.estado;
      persistLocal(state);
      listeners.forEach((l) => l());
    }
  } catch (e) {
    console.error('No se pudo cargar bootstrap desde backend; se usa modo local.', e);
  }
}

void bootstrapFromApi();
