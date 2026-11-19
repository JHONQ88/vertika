import type {
  Comprobante,
  Copropiedad,
  Documento,
  Linea,
  PreAsiento,
  Retencion,
  Rubro,
  Tercero,
  Unidad,
} from './types';
import { CUENTA_MAP, RUBRO_TEMPLATE } from './puc';
import { ultimoDia } from './format';

export const MESES = ['2026-09', '2026-10', '2026-11'] as const;
export const PERIODO_ACTUAL = '2026-11';

// ── Utilidades numéricas ────────────────────────────────────────────────────
const round100 = (n: number) => Math.round(n / 100) * 100;
const round1000 = (n: number) => Math.round(n / 1000) * 1000;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function hashStr(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Proveedores (compartidos por todas las copropiedades) ───────────────────
export const PROVEEDORES: Tercero[] = [
  { id: 'prov-atlas', nombre: 'Seguridad Atlas S.A.S.', tipo: 'PROVEEDOR', documento: '900.412.887', dv: '3', email: 'facturacion@atlas.co', telefono: '+57 601 745 8899', ciudad: 'Bogotá D.C.', retefuentePct: 4, reteicaPct: 0.966, reteivaPct: 15, noObligado: false },
  { id: 'prov-limpieza', nombre: 'Limpieza Total S.A.S.', tipo: 'PROVEEDOR', documento: '901.223.456', dv: '7', email: 'cobros@limpiezatotal.co', telefono: '+57 601 887 1234', ciudad: 'Bogotá D.C.', retefuentePct: 4, reteicaPct: 0.966, reteivaPct: 15, noObligado: false },
  { id: 'prov-enel', nombre: 'Enel Colombia S.A. ESP', tipo: 'PROVEEDOR', documento: '860.007.211', dv: '6', email: 'servicioalcliente@enel.com', telefono: '+57 601 601 0601', ciudad: 'Bogotá D.C.', retefuentePct: 0, reteicaPct: 0, reteivaPct: 0, noObligado: false, regimenEspecial: true },
  { id: 'prov-eaab', nombre: 'EAAB Esp', tipo: 'PROVEEDOR', documento: '899.999.094', dv: '4', email: 'atencion@eaab.com.co', telefono: '+57 601 355 5555', ciudad: 'Bogotá D.C.', retefuentePct: 0, reteicaPct: 0.966, reteivaPct: 0, noObligado: false, regimenEspecial: true },
  { id: 'prov-elevadores', nombre: 'Elevadores Andinos Ltda.', tipo: 'PROVEEDOR', documento: '830.112.554', dv: '1', email: 'facturacion@elevadoresandinos.com', telefono: '+57 601 900 2233', ciudad: 'Bogotá D.C.', retefuentePct: 4, reteicaPct: 0.966, reteivaPct: 15, noObligado: false },
  { id: 'prov-seguros', nombre: 'Aseguradora del Norte S.A.', tipo: 'PROVEEDOR', documento: '890.903.937', dv: '8', email: 'servicio@aseguradoranorte.co', telefono: '+57 601 660 4400', ciudad: 'Bogotá D.C.', retefuentePct: 4, reteicaPct: 0.966, reteivaPct: 15, noObligado: false },
  { id: 'prov-jardineria', nombre: 'José Rodríguez — Jardinero', tipo: 'PROVEEDOR', documento: '8.012.447', email: 'jrodriguez@correo.co', telefono: '+57 310 456 7890', ciudad: 'Bogotá D.C.', retefuentePct: 4, reteicaPct: 0, reteivaPct: 0, noObligado: true },
  { id: 'prov-contador', nombre: 'Carlos Andrés Mejía — Contador', tipo: 'PROVEEDOR', documento: '1.020.304.556', email: 'camejia@contador.co', telefono: '+57 300 876 5432', ciudad: 'Bogotá D.C.', retefuentePct: 11, reteicaPct: 0.966, reteivaPct: 0, noObligado: false },
  { id: 'prov-revisoria', nombre: 'Marta Lucía Peña — Revisora Fiscal', tipo: 'PROVEEDOR', documento: '52.334.887', email: 'mlpena@revisoria.co', telefono: '+57 315 224 9900', ciudad: 'Bogotá D.C.', retefuentePct: 11, reteicaPct: 0.966, reteivaPct: 0, noObligado: false },
  { id: 'prov-banco', nombre: 'Banco de Bogotá', tipo: 'PROVEEDOR', documento: '860.002.222', dv: '5', email: 'empresas@bancodebogota.com', telefono: '+57 601 382 0000', ciudad: 'Bogotá D.C.', retefuentePct: 0, reteicaPct: 0, reteivaPct: 0, noObligado: false },
];

const PROVEEDOR_MAP: Record<string, Tercero> = Object.fromEntries(PROVEEDORES.map((p) => [p.id, p]));

// ── Nombres para propietarios y arrendatarios ──────────────────────────────
const NOMBRES = [
  'Andrés', 'Camila', 'Fernando', 'María', 'Jorge', 'Laura', 'Ricardo', 'Paula',
  'Santiago', 'Valentina', 'Hernán', 'Claudia', 'Óscar', 'Daniela', 'Rafael', 'Patricia',
  'Gustavo', 'Mónica', 'Álvaro', 'Cecilia', 'Rodrigo', 'Isabel', 'Eduardo', 'Teresa',
];
const APELLIDOS = [
  'García', 'Rodríguez', 'Martínez', 'López', 'Hernández', 'González', 'Pérez', 'Sánchez',
  'Ramírez', 'Torres', 'Flórez', 'Gómez', 'Díaz', 'Ruiz', 'Moreno', 'Muñoz',
];

function nombrePersona(i: number): string {
  const n = NOMBRES[i % NOMBRES.length];
  const a1 = APELLIDOS[(i * 7 + 3) % APELLIDOS.length];
  const a2 = APELLIDOS[(i * 5 + 11) % APELLIDOS.length];
  return `${n} ${a1} ${a2}`;
}

// ── Definición de copropiedades ─────────────────────────────────────────────
interface EmpresaDef {
  id: string;
  nit: string;
  razonSocial: string;
  nombreCorto: string;
  sigla: string;
  ciudad: string;
  direccion: string;
  grupoNiif: 2 | 3;
  color: string;
  escala: number;
  torres: string[];
  pisos: number;
  porPiso: number;
  baseArea: number;
  tipo: Unidad['tipo'];
}

const EMPRESA_DEFS: EmpresaDef[] = [
  {
    id: 'altavista', nit: '800.143.221-7', razonSocial: 'Conjunto Residencial Altavista',
    nombreCorto: 'Altavista', sigla: 'ALV', ciudad: 'Bogotá D.C.',
    direccion: 'Cra. 11 # 82-45 · Torres A y B', grupoNiif: 2, color: '#0E9F6E', escala: 1,
    torres: ['Torre A', 'Torre B'], pisos: 6, porPiso: 2, baseArea: 88, tipo: 'APARTAMENTO',
  },
  {
    id: 'colina', nit: '800.258.904-2', razonSocial: 'Edificio Colina Campestre',
    nombreCorto: 'Colina Campestre', sigla: 'COL', ciudad: 'Bogotá D.C.',
    direccion: 'Calle 116 # 7-50', grupoNiif: 2, color: '#2F6BFF', escala: 0.55,
    torres: ['Bloque A'], pisos: 6, porPiso: 2, baseArea: 95, tipo: 'APARTAMENTO',
  },
  {
    id: 'plaza-norte', nit: '811.020.456-8', razonSocial: 'Centro Comercial Plaza Norte',
    nombreCorto: 'Plaza Norte', sigla: 'PLZ', ciudad: 'Bogotá D.C.',
    direccion: 'Av. 15 # 124-30', grupoNiif: 3, color: '#B45CF0', escala: 0.75,
    torres: ['Etapa 1', 'Etapa 2'], pisos: 9, porPiso: 1, baseArea: 60, tipo: 'LOCAL',
  },
];

// ── Rubros y presupuesto ────────────────────────────────────────────────────
function buildRubros(empresaId: string, escala: number): Rubro[] {
  return RUBRO_TEMPLATE.map((t) => ({
    id: `${empresaId}-r-${t.key}`,
    empresaId,
    key: t.key,
    nombre: t.nombre,
    centro: t.centro,
    cuenta: t.cuenta,
    presupuestoAnual: round100(t.baseAnual * escala),
  }));
}

function presupuestoDe(rubros: Rubro[]): number {
  return rubros.reduce((s, r) => s + r.presupuestoAnual, 0);
}

// ── Saldos iniciales (balance de apertura) ──────────────────────────────────
function buildSaldos(escala: number): Record<string, number> {
  const s = (n: number) => round100(n * escala);
  const activo: Record<string, number> = {
    '110505': s(500_000),
    '111005': s(210_000_000),
    '111010': s(38_000_000),
    '130505': s(24_000_000),
    '130510': s(0),
    '130515': s(0),
    '130520': s(0),
    '135515': s(0),
    '139905': s(1_200_000),
    '152405': s(320_000_000),
    '152805': s(12_000_000),
    '159215': s(84_000_000),
  };
  const pasivo: Record<string, number> = {
    '220505': s(14_000_000),
    '236540': s(1_200_000),
    '236705': s(800_000),
    '236801': s(300_000),
    '250505': s(4_000_000),
    '280505': s(2_500_000),
    '281510': s(36_000_000),
  };
  const totalActivo = Object.entries(activo).reduce(
    (sum, [codigo, valor]) => sum + (CUENTA_MAP[codigo]?.naturaleza === 'C' ? -valor : valor),
    0,
  );
  const totalPasivo = Object.values(pasivo).reduce((a, b) => a + b, 0);
  const patrimonio: Record<string, number> = {
    '310505': s(380_000_000),
    '330505': s(20_000_000),
    '360505': 0,
    '370505': 0,
  };
  const fijo = patrimonio['310505'] + patrimonio['330505'];
  patrimonio['370505'] = totalActivo - totalPasivo - fijo;

  const cuentasCero = [
    ...Array.from({ length: 40 }, (_, i) => `4170${String(i + 5).padStart(2, '0')}`),
    '510506', '510530', '510536', '510539', '510542', '510548', '510551',
    '511005', '512010', '513010', '513505', '513510', '513525', '513530', '513535',
    '513540', '514505', '514510', '514515', '516005', '519505', '519510', '519520',
    '519530', '519905', '530520', '540505', '540525',
  ].filter((c) => !activo[c] && !pasivo[c] && !patrimonio[c]);

  const salida: Record<string, number> = { ...activo, ...pasivo, ...patrimonio };
  for (const c of cuentasCero) salida[c] = 0;
  return salida;
}

// ── Unidades y terceros por copropiedad ────────────────────────────────────
function buildUnidadesYTerceros(
  def: EmpresaDef,
  rnd: () => number,
): { unidades: Unidad[]; terceros: Tercero[] } {
  const unidades: Unidad[] = [];
  let indice = 0;
  def.torres.forEach((torre, ti) => {
    for (let piso = 1; piso <= def.pisos; piso++) {
      for (let u = 1; u <= def.porPiso; u++) {
        const numero = `${piso}0${u}`;
        const area = Math.round(def.baseArea + piso * 3.5 + u * 6 + ti * 8 + rnd() * 8);
        const propietario: Tercero = {
          id: `t-${def.id}-${indice}`,
          empresaId: def.id,
          nombre: nombrePersona(indice),
          tipo: 'PROPIETARIO',
          documento: String(10_000_000 + Math.floor(rnd() * 80_000_000)),
          email: `propietario${indice}@correo.co`,
          telefono: `+57 3${String(10 + Math.floor(rnd() * 8))} ${String(100_0000 + Math.floor(rnd() * 8_999_999)).slice(0, 6)}`,
          ciudad: def.ciudad,
          retefuentePct: 0,
          reteicaPct: 0,
          reteivaPct: 0,
          noObligado: false,
        };
        const arrendado = indice % 4 === 1;
        let arrendatario: Tercero | undefined;
        if (arrendado) {
          arrendatario = {
            id: `t-${def.id}-${indice}-arr`,
            empresaId: def.id,
            nombre: nombrePersona(indice + 17),
            tipo: 'ARRENDATARIO',
            documento: String(20_000_000 + Math.floor(rnd() * 80_000_000)),
            email: `arrendatario${indice}@correo.co`,
            telefono: `+57 3${String(10 + Math.floor(rnd() * 8))} ${String(100_0000 + Math.floor(rnd() * 8_999_999)).slice(0, 6)}`,
            ciudad: def.ciudad,
            retefuentePct: 0,
            reteicaPct: 0,
            reteivaPct: 0,
            noObligado: false,
          };
        }
        unidades.push({
          id: `${def.id}-${torre.replace(/\s/g, '')}-${numero}`,
          empresaId: def.id,
          torre,
          numero,
          tipo: def.tipo,
          area,
          coeficiente: 0,
          matricula: `50N-${String(100_000 + indice * 137)}`,
          propietarioId: propietario.id,
          arrendatarioId: arrendatario?.id,
          carteraCongelada: indice === 5,
        });
        indice++;
      }
    }
  });

  const totalArea = unidades.reduce((s, u) => s + u.area, 0);
  let acumulado = 0;
  unidades.forEach((u, i) => {
    if (i === unidades.length - 1) {
      u.coeficiente = round6(100 - acumulado);
    } else {
      u.coeficiente = round6((u.area / totalArea) * 100);
      acumulado = round6(acumulado + u.coeficiente);
    }
  });

  const terceros: Tercero[] = [];
  unidades.forEach((u) => {
    const p = nombrePersona(Number(u.propietarioId.split('-').pop()));
    const doc = String(10_000_000 + Number(u.propietarioId.split('-').pop()) * 7_513 % 80_000_000);
    terceros.push({
      id: u.propietarioId,
      empresaId: def.id,
      nombre: p,
      tipo: 'PROPIETARIO',
      documento: doc,
      email: `${p.toLowerCase().replace(/\s/g, '.')}@correo.co`,
      telefono: `+57 31${Number(u.propietarioId.split('-').pop()) % 10} 555 00${String(Number(u.propietarioId.split('-').pop())).padStart(2, '0')}`,
      ciudad: def.ciudad,
      retefuentePct: 0,
      reteicaPct: 0,
      reteivaPct: 0,
      noObligado: false,
    });
    if (u.arrendatarioId) {
      const idx = Number(u.arrendatarioId.split('-')[2]);
      const nombre = nombrePersona(idx + 17);
      terceros.push({
        id: u.arrendatarioId,
        empresaId: def.id,
        nombre,
        tipo: 'ARRENDATARIO',
        documento: String(20_000_000 + idx * 11_317 % 80_000_000),
        email: `${nombre.toLowerCase().replace(/\s/g, '.')}@correo.co`,
        telefono: `+57 31${idx % 10} 444 00${String(idx).padStart(2, '0')}`,
        ciudad: def.ciudad,
        retefuentePct: 0,
        reteicaPct: 0,
        reteivaPct: 0,
        noObligado: false,
      });
    }
  });

  return { unidades, terceros };
}

// ── Plantillas de facturas de proveedores ──────────────────────────────────
interface FacturaTpl {
  providerId: string;
  cuenta: string;
  rubroKey: string;
  descripcion: string;
  base: number;
  ivaPct: number;
  dia: number;
}

const FACTURAS: FacturaTpl[] = [
  { providerId: 'prov-atlas', cuenta: '513505', rubroKey: 'VIG', descripcion: 'Vigilancia y seguridad', base: 18_500_000, ivaPct: 19, dia: 2 },
  { providerId: 'prov-limpieza', cuenta: '513510', rubroKey: 'ASE', descripcion: 'Aseo y cafetería', base: 4_800_000, ivaPct: 19, dia: 3 },
  { providerId: 'prov-enel', cuenta: '513525', rubroKey: 'SPU', descripcion: 'Energía eléctrica', base: 3_120_400, ivaPct: 0, dia: 8 },
  { providerId: 'prov-eaab', cuenta: '513530', rubroKey: 'SPU', descripcion: 'Acueducto y alcantarillado', base: 1_845_900, ivaPct: 0, dia: 9 },
  { providerId: 'prov-elevadores', cuenta: '514505', rubroKey: 'ASC', descripcion: 'Mantenimiento de ascensores', base: 2_450_000, ivaPct: 19, dia: 5 },
  { providerId: 'prov-seguros', cuenta: '513010', rubroKey: 'SEG', descripcion: 'Póliza de áreas comunes', base: 950_000, ivaPct: 19, dia: 12 },
  { providerId: 'prov-jardineria', cuenta: '514515', rubroKey: 'MAN', descripcion: 'Jardinería y zonas verdes', base: 850_000, ivaPct: 0, dia: 14 },
  { providerId: 'prov-contador', cuenta: '511005', rubroKey: 'HON', descripcion: 'Honorarios contaduría', base: 1_800_000, ivaPct: 0, dia: 15 },
  { providerId: 'prov-banco', cuenta: '519505', rubroKey: 'FIN', descripcion: 'Comisiones y gastos bancarios', base: 380_000, ivaPct: 0, dia: 16 },
];

/** Proveedores que quedan como pre-asientos pendientes en noviembre. */
const PROVEEDORES_PENDIENTES: Record<string, string[]> = {
  altavista: ['prov-atlas', 'prov-enel', 'prov-eaab', 'prov-jardineria', 'prov-revisoria'],
  colina: ['prov-atlas', 'prov-elevadores'],
  'plaza-norte': ['prov-limpieza', 'prov-seguros'],
};

const UNIDADES_PENDIENTES: Record<string, string[]> = {
  altavista: ['altavista-TorreA-402', 'altavista-TorreB-601'],
  colina: ['colina-BloqueA-201'],
  'plaza-norte': ['plaza-norte-Etapa1-101'],
};

// ── Constructor de comprobantes ────────────────────────────────────────────
interface Ctx {
  empresa: Copropiedad;
  unidades: Unidad[];
  terceros: Tercero[];
  rubros: Rubro[];
  rnd: () => number;
  consecutivos: Record<string, number>;
  comprobantes: Comprobante[];
}

let lineaSeq = 0;
function linea(
  cuenta: string,
  descripcion: string,
  debito = 0,
  credito = 0,
  extra?: Partial<Linea>,
): Linea {
  lineaSeq++;
  return {
    id: `L${lineaSeq.toString(36)}`,
    cuenta,
    descripcion,
    debito: Math.max(0, Math.round(debito * 100) / 100),
    credito: Math.max(0, Math.round(credito * 100) / 100),
    ...extra,
  };
}

function agregar(
  ctx: Ctx,
  tipo: Comprobante['tipo'],
  periodo: string,
  fecha: string,
  origen: Comprobante['origen'],
  descripcion: string,
  lineas: Linea[],
  referencia?: string,
): Comprobante {
  const consecutivo = (ctx.consecutivos[`${ctx.empresa.id}:${tipo}`] ?? 0) + 1;
  ctx.consecutivos[`${ctx.empresa.id}:${tipo}`] = consecutivo;
  const totalDebito = lineas.reduce((s, l) => s + l.debito, 0);
  const totalCredito = lineas.reduce((s, l) => s + l.credito, 0);
  const comp: Comprobante = {
    id: `${ctx.empresa.id}-${tipo}-${consecutivo}`,
    empresaId: ctx.empresa.id,
    periodo,
    tipo,
    consecutivo,
    fecha,
    estado: 'ASENTADO',
    origen,
    descripcion,
    lineas,
    totalDebito,
    totalCredito,
    referencia,
    hash: hashStr(JSON.stringify([tipo, consecutivo, fecha, lineas.map((l) => [l.cuenta, l.debito, l.credito])])),
    creadoPor: 'Contador demo',
    createdAt: `${fecha}T09:00:00.000Z`,
  };
  ctx.comprobantes.push(comp);
  return comp;
}

function rubroIdDe(ctx: Ctx, key: string): string | undefined {
  return ctx.rubros.find((r) => r.key === key)?.id;
}

function lineasCompra(
  cuenta: string,
  rubroId: string | undefined,
  descripcion: string,
  base: number,
  ivaPct: number,
  provider: Tercero,
): Linea[] {
  const iva = round100((base * ivaPct) / 100);
  const total = base + iva;
  const rf = round100((base * provider.retefuentePct) / 100);
  const ri = round100((base * provider.reteicaPct) / 100);
  const riva = round100((iva * provider.reteivaPct) / 100);
  const neto = total - rf - ri - riva;
  const lineas: Linea[] = [
    linea(cuenta, descripcion, base, 0, { terceroId: provider.id, rubroId }),
    linea('220505', 'Cuenta por pagar', 0, neto, { terceroId: provider.id }),
  ];
  if (iva > 0) lineas.splice(1, 0, linea('135515', 'IVA descontable', iva, 0, { terceroId: provider.id }));
  if (rf > 0) lineas.push(linea('236540', 'Retención en la fuente', 0, rf));
  if (ri > 0) lineas.push(linea('236801', 'Retención de ICA', 0, ri));
  if (riva > 0) lineas.push(linea('236705', 'Retención de IVA', 0, riva));
  return lineas;
}

export function cuotaMensual(empresa: Copropiedad, unidad: Unidad): number {
  return round1000(((empresa.presupuestoAnual / 12) * unidad.coeficiente) / 100);
}

function fondoDe(cuota: number, pct: number): number {
  return round100((cuota * pct) / 100);
}

// ── Generación de la contabilidad mensual ───────────────────────────────────
function generarComprobantes(ctx: Ctx): void {
  const { empresa, unidades, rnd } = ctx;
  const escala = empresa.escala;

  for (const mes of MESES) {
    const esNoviembre = mes === PERIODO_ACTUAL;

    // 1) Liquidación masiva de expensas
    const lineasLiquidacion: Linea[] = [];
    let totalIngreso = 0;
    let totalFondo = 0;
    for (const u of unidades) {
      const cuota = cuotaMensual(empresa, u);
      const fondo = fondoDe(cuota, empresa.fondoImprevistosPct);
      totalIngreso += cuota - fondo;
      totalFondo += fondo;
      const pagador = u.arrendatarioId ?? u.propietarioId;
      lineasLiquidacion.push(
        linea('130505', `Expensa ordinaria ${u.torre} ${u.numero}`, cuota, 0, {
          unidadId: u.id,
          terceroId: pagador,
        }),
      );
    }
    lineasLiquidacion.push(linea('417005', 'Cuotas de administración ordinarias', 0, totalIngreso));
    lineasLiquidacion.push(linea('281510', 'Fondo de imprevistos Ley 675', 0, totalFondo));
    agregar(ctx, 'CC', mes, `${mes}-01`, 'AGENTE_IA_LIQUIDADOR', `Liquidación masiva de expensas ${mes}`, lineasLiquidacion);

    // 2) Recaudo masivo
    const excluidas = new Set(UNIDADES_PENDIENTES[empresa.id] ?? []);
    const lineasRecaudo: Linea[] = [];
    let totalRecaudo = 0;
    let totalDescuento = 0;
    for (const u of unidades) {
      if (esNoviembre && excluidas.has(u.id)) continue;
      const paga = rnd() < (esNoviembre ? 0.72 : 0.85);
      if (!paga) continue;
      const cuota = cuotaMensual(empresa, u);
      const descuento = esNoviembre && rnd() < 0.5 ? round100((cuota * empresa.descuentoProntoPagoPct) / 100) : 0;
      const pagador = u.arrendatarioId ?? u.propietarioId;
      lineasRecaudo.push(
        linea('111005', `Recaudo ${u.torre} ${u.numero}`, cuota - descuento, 0, { unidadId: u.id, terceroId: pagador }),
      );
      lineasRecaudo.push(
        linea('130505', `Abono expensa ${u.torre} ${u.numero}`, 0, cuota, { unidadId: u.id, terceroId: pagador }),
      );
      if (descuento > 0) {
        lineasRecaudo.push(
          linea('417035', `Descuento pronto pago ${u.torre} ${u.numero}`, descuento, 0, { unidadId: u.id, terceroId: pagador }),
        );
        totalDescuento += descuento;
      }
      totalRecaudo += cuota - descuento;
    }
    if (lineasRecaudo.length > 0) {
      agregar(ctx, 'RC', mes, `${mes}-06`, 'WEBHOOK_NFC', `Recaudo masivo expensas ${mes}`, lineasRecaudo);
    }

    // 3) Facturas de proveedores
    const pendientes = new Set(PROVEEDORES_PENDIENTES[empresa.id] ?? []);
    const comprasDelMes: Comprobante[] = [];
    FACTURAS.forEach((tpl, i) => {
      if (esNoviembre && pendientes.has(tpl.providerId)) return;
      if (!esNoviembre && rnd() < 0.08 && i > 0) return;
      const provider = PROVEEDOR_MAP[tpl.providerId];
      const base = round1000(tpl.base * escala);
      const comp = agregar(
        ctx,
        'CC',
        mes,
        `${mes}-${String(tpl.dia).padStart(2, '0')}`,
        'AGENTE_IA_DIAN',
        `${tpl.descripcion} · ${provider.nombre}`,
        lineasCompra(tpl.cuenta, rubroIdDe(ctx, tpl.rubroKey), tpl.descripcion, base, tpl.ivaPct, provider),
        `FA-${mes}-${String(i + 1).padStart(3, '0')}`,
      );
      comprasDelMes.push(comp);
    });

    // 4) Nómina
    const nominaBase = round1000(12_000_000 * escala);
    agregar(ctx, 'CC', mes, `${mes}-01`, 'CONTADOR_MANUAL', `Nómina y prestaciones ${mes}`, [
      linea('510506', 'Sueldos y salarios', nominaBase, 0, { rubroId: rubroIdDe(ctx, 'ADM') }),
      linea('510548', 'Aportes a seguridad social', round1000(nominaBase * 0.32), 0, { rubroId: rubroIdDe(ctx, 'ADM') }),
      linea('250505', 'Salarios y prestaciones por pagar', 0, round1000(nominaBase * 1.32)),
    ]);

    // 5) Egreso por dispersión a proveedor
    const aPagar = comprasDelMes[0];
    if (aPagar) {
      agregar(ctx, 'CE', mes, `${mes}-18`, 'TESORERIA_PAYOUT', `Dispersión de pagos a proveedores ${mes}`, [
        linea('220505', 'Proveedores nacionales', aPagar.totalCredito, 0),
        linea('111005', 'Bancos - cuenta recaudadora', 0, aPagar.totalCredito),
      ], aPagar.referencia);
    }

    // 6) Cierre mensual automático (sep y oct)
    if (!esNoviembre) {
      const depreciacion = round100(2_500_000 * escala);
      const provision = round100(1_200_000 * escala);
      const trasladoFondo = totalFondo;
      const lineasCierre: Linea[] = [
        linea('516005', 'Depreciación de PP&E', depreciacion, 0, { rubroId: rubroIdDe(ctx, 'MAN') }),
        linea('159215', 'Depreciación acumulada', 0, depreciacion),
        linea('519905', 'Provisión deterioro de cartera', provision, 0, { rubroId: rubroIdDe(ctx, 'FIN') }),
        linea('139905', 'Deterioro de cartera', 0, provision),
        linea('111010', 'Bancos - Fondo de imprevistos', trasladoFondo, 0),
        linea('111005', 'Bancos - cuenta recaudadora', 0, trasladoFondo),
      ];
      agregar(ctx, 'NC', mes, ultimoDia(mes), 'CIERRE_AUTOMATICO', `Cierre contable ${mes}`, lineasCierre);
    }
  }
}

// ── Pre-asientos de IA pendientes ───────────────────────────────────────────
function docCompra(
  provider: Tercero,
  descripcion: string,
  base: number,
  iva: number,
  retenciones: Retencion[],
  fecha: string,
  numero: string,
  xml?: string,
): Documento {
  return {
    clase: 'FACTURA',
    numero,
    emisor: provider.nombre,
    nit: provider.documento,
    fecha,
    cufe: xml ? undefined : `CUFE-${hashStr(numero).toUpperCase()}`,
    items: [{ descripcion, cantidad: 1, valorUnitario: base }],
    subtotal: base,
    iva,
    total: base + iva,
    retenciones,
    xml,
  };
}

function retencionesDe(provider: Tercero, base: number, iva: number): Retencion[] {
  const rf = round100((base * provider.retefuentePct) / 100);
  const ri = round100((base * provider.reteicaPct) / 100);
  const riva = round100((iva * provider.reteivaPct) / 100);
  const salida: Retencion[] = [];
  if (rf > 0) salida.push({ nombre: 'ReteFuente', base, tarifa: provider.retefuentePct, valor: rf, cuenta: '236540' });
  if (ri > 0) salida.push({ nombre: 'ReteICA', base, tarifa: provider.reteicaPct, valor: ri, cuenta: '236801' });
  if (riva > 0) salida.push({ nombre: 'ReteIVA', base: iva, tarifa: provider.reteivaPct, valor: riva, cuenta: '236705' });
  return salida;
}

const XML_VIGILANCIA = `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <cbc:ID>FA-2026-11-00842</cbc:ID>
  <cbc:IssueDate>2026-11-02</cbc:IssueDate>
  <cac:AccountingSupplierParty>
    <cac:Party><cbc:CompanyID schemeID="3">900412887</cbc:CompanyID>
      <cac:PartyLegalEntity><cbc:RegistrationName>SEGURIDAD ATLAS S.A.S.</cbc:RegistrationName>
  <cac:AccountingCustomerParty>
    <cac:Party><cbc:CompanyID schemeID="7">800143221</cbc:CompanyID>
  <cac:TaxTotal><cbc:TaxAmount currencyID="COP">3515000.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="COP">22015000.00</cbc:PayableAmount>
</Invoice>`;

const XML_ENERGIA = `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <cbc:ID>ENEL-8891203</cbc:ID>
  <cbc:IssueDate>2026-11-08</cbc:IssueDate>
  <cac:AccountingSupplierParty>
    <cac:Party><cbc:CompanyID schemeID="6">860007211</cbc:CompanyID>
      <cac:PartyLegalEntity><cbc:RegistrationName>ENEL COLOMBIA S.A. ESP</cbc:RegistrationName>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="COP">3120400.00</cbc:PayableAmount>
</Invoice>`;

const XML_ACUEDUCTO = `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <cbc:ID>EAAB-55671</cbc:ID>
  <cbc:IssueDate>2026-11-09</cbc:IssueDate>
  <cac:AccountingSupplierParty>
    <cac:Party><cbc:CompanyID schemeID="4">899999094</cbc:CompanyID>
      <cac:PartyLegalEntity><cbc:RegistrationName>EAAB ESP</cbc:RegistrationName>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="COP">1845900.00</cbc:PayableAmount>
</Invoice>`;

function preCompra(
  empresa: Copropiedad,
  provider: Tercero,
  descripcion: string,
  cuenta: string,
  rubroId: string | undefined,
  base: number,
  ivaPct: number,
  fecha: string,
  numero: string,
  confianza: number,
  agente: string,
  notas: string[],
  xml?: string,
): PreAsiento {
  const iva = round100((base * ivaPct) / 100);
  const retenciones = retencionesDe(provider, base, iva);
  const lineas = lineasCompra(cuenta, rubroId, descripcion, base, ivaPct, provider);
  return {
    id: `pre-${empresa.id}-${numero}`,
    empresaId: empresa.id,
    periodo: PERIODO_ACTUAL,
    tipo: 'CC',
    fecha,
    agente,
    confianza,
    terceroId: provider.id,
    rubroId,
    descripcion: `${descripcion} · ${provider.nombre}`,
    documento: docCompra(provider, descripcion, base, iva, retenciones, fecha, numero, xml),
    lineas,
    estado: 'PENDIENTE',
    notas,
  };
}

function preRecibo(
  empresa: Copropiedad,
  unidad: Unidad,
  metodo: string,
  referencia: string,
  cuota: number,
  descuento: number,
  intereses: number,
  fecha: string,
  confianza: number,
): PreAsiento {
  const pagador = unidad.arrendatarioId ?? unidad.propietarioId;
  const total = cuota + intereses;
  const lineas: Linea[] = [
    linea('111005', `Recaudo ${unidad.torre} ${unidad.numero}`, total - descuento, 0, {
      unidadId: unidad.id,
      terceroId: pagador,
    }),
  ];
  if (descuento > 0) {
    lineas.push(
      linea('417035', `Descuento pronto pago ${unidad.torre} ${unidad.numero}`, descuento, 0, {
        unidadId: unidad.id,
        terceroId: pagador,
      }),
    );
  }
  if (intereses > 0) {
    lineas.push(linea('130515', `Intereses de mora ${unidad.torre} ${unidad.numero}`, 0, intereses, { unidadId: unidad.id, terceroId: pagador }));
  }
  lineas.push(linea('130505', `Expensa ${unidad.torre} ${unidad.numero}`, 0, cuota, { unidadId: unidad.id, terceroId: pagador }));

  const documento: Documento = {
    clase: 'RECIBO',
    numero: referencia,
    emisor: empresa.razonSocial,
    nit: empresa.nit,
    fecha,
    items: [
      { descripcion: `Cuota de administración ${empresa.nombreCorto}`, cantidad: 1, valorUnitario: cuota },
      ...(descuento > 0 ? [{ descripcion: 'Descuento por pronto pago', cantidad: 1, valorUnitario: -descuento }] : []),
      ...(intereses > 0 ? [{ descripcion: 'Intereses de mora', cantidad: 1, valorUnitario: intereses }] : []),
    ],
    subtotal: cuota + intereses,
    iva: 0,
    total,
    retenciones: [],
    metodo,
    referencia,
    unidadLabel: `${unidad.torre} ${unidad.numero}`,
    pagador,
  };

  return {
    id: `pre-${empresa.id}-${referencia}`,
    empresaId: empresa.id,
    periodo: PERIODO_ACTUAL,
    tipo: 'RC',
    fecha,
    agente: 'AGENTE_CONCILIADOR',
    confianza,
    terceroId: pagador,
    unidadId: unidad.id,
    descripcion: `Recaudo ${unidad.torre} ${unidad.numero} · ${metodo}`,
    documento,
    lineas,
    estado: 'PENDIENTE',
    notas: [
      `Referencia ${referencia} confirmada por ${metodo}`,
      'Prelación legal aplicada: intereses, sanciones y capital',
      'Paz y salvo generado automáticamente',
    ],
  };
}

function preSoporte(
  empresa: Copropiedad,
  provider: Tercero,
  base: number,
  fecha: string,
  numero: string,
  confianza: number,
): PreAsiento {
  const retenciones = retencionesDe(provider, base, 0);
  const rf = retenciones.find((r) => r.nombre === 'ReteFuente')?.valor ?? 0;
  const neto = base - rf;
  const lineas: Linea[] = [
    linea('514515', 'Jardinería y zonas verdes', base, 0, { terceroId: provider.id, rubroId: `${empresa.id}-r-MAN` }),
    linea('220505', 'Cuenta por pagar', 0, neto, { terceroId: provider.id }),
  ];
  if (rf > 0) lineas.push(linea('236540', 'Retención en la fuente', 0, rf));
  return {
    id: `pre-${empresa.id}-${numero}`,
    empresaId: empresa.id,
    periodo: PERIODO_ACTUAL,
    tipo: 'DS',
    fecha,
    agente: 'AGENTE_IA_DIAN',
    confianza,
    terceroId: provider.id,
    rubroId: `${empresa.id}-r-MAN`,
    descripcion: `Documento soporte · ${provider.nombre}`,
    documento: {
      clase: 'SOPORTE',
      numero,
      emisor: provider.nombre,
      nit: provider.documento,
      fecha,
      items: [{ descripcion: 'Servicio de jardinería', cantidad: 1, valorUnitario: base }],
      subtotal: base,
      iva: 0,
      total: base,
      retenciones,
      xml: '<Documento_soporte xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">\n  <cbc:ID>DS-2026-118</cbc:ID>\n  <cbc:IssueDate>2026-11-14</cbc:IssueDate>\n  <cac:AccountingSupplierParty><cac:Party><cbc:CompanyID>8012447</cbc:CompanyID></cac:Party></cac:AccountingSupplierParty>\n  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="COP">850000.00</cbc:PayableAmount></cac:LegalMonetaryTotal>\n</Documento_soporte>',
    },
    lineas,
    estado: 'PENDIENTE',
    notas: [
      'Persona natural no obligada a facturar',
      'Documento soporte electrónico generado ante la DIAN',
      'Eventos RADIAN 01 y 02 programados',
    ],
  };
}

function preHonorarios(
  empresa: Copropiedad,
  provider: Tercero,
  base: number,
  fecha: string,
  numero: string,
  confianza: number,
): PreAsiento {
  const retenciones = retencionesDe(provider, base, 0);
  const totalRet = retenciones.reduce((s, r) => s + r.valor, 0);
  const neto = base - totalRet;
  const lineas: Linea[] = [
    linea('511005', 'Honorarios revisoría fiscal', base, 0, { terceroId: provider.id, rubroId: `${empresa.id}-r-HON` }),
    linea('220505', 'Cuenta por pagar', 0, neto, { terceroId: provider.id }),
  ];
  for (const r of retenciones) {
    lineas.push(linea(r.cuenta, r.nombre, 0, r.valor));
  }
  return {
    id: `pre-${empresa.id}-${numero}`,
    empresaId: empresa.id,
    periodo: PERIODO_ACTUAL,
    tipo: 'CC',
    fecha,
    agente: 'AGENTE_IA_OCR',
    confianza,
    terceroId: provider.id,
    rubroId: `${empresa.id}-r-HON`,
    descripcion: `Honorarios revisoría fiscal · ${provider.nombre}`,
    documento: docCompra(provider, 'Honorarios revisoría fiscal', base, 0, retenciones, fecha, numero),
    lineas,
    estado: 'PENDIENTE',
    notas: ['OCR con 96,8% de confianza', 'ReteFuente 11% sobre servicios personales', 'ReteICA tarifa Bogotá'],
  };
}

function buildPreAsientos(
  empresas: Copropiedad[],
  unidades: Unidad[],
  rubros: Rubro[],
): PreAsiento[] {
  const salida: PreAsiento[] = [];
  const porId = new Map(empresas.map((e) => [e.id, e]));
  const rubro = (empresaId: string, key: string) =>
    rubros.find((r) => r.empresaId === empresaId && r.key === key)?.id;
  const unidad = (id: string) => unidades.find((u) => u.id === id)!;

  const altavista = porId.get('altavista')!;
  const u402 = unidad('altavista-TorreA-402');
  const u601 = unidad('altavista-TorreB-601');
  const cuota402 = cuotaMensual(altavista, u402);
  const cuota601 = cuotaMensual(altavista, u601);

  const atlas = PROVEEDOR_MAP['prov-atlas'];
  const enel = PROVEEDOR_MAP['prov-enel'];
  const eaab = PROVEEDOR_MAP['prov-eaab'];
  const jardinero = PROVEEDOR_MAP['prov-jardineria'];
  const revisor = PROVEEDOR_MAP['prov-revisoria'];

  salida.push(
    preCompra(
      altavista, atlas, 'Vigilancia y seguridad', '513505', rubro('altavista', 'VIG'),
      18_500_000, 19, '2026-11-02', 'FA-2026-11-00842', 97.4, 'AGENTE_IA_DIAN',
      ['XML UBL 2.1 validado contra la DIAN', 'IVA 19% sobre AIU', 'ReteICA tarifa Bogotá 0,966%'],
      XML_VIGILANCIA,
    ),
  );
  salida.push(
    preCompra(
      altavista, enel, 'Energía eléctrica', '513525', rubro('altavista', 'SPU'),
      3_120_400, 0, '2026-11-08', 'ENEL-8891203', 92.1, 'AGENTE_IA_OCR',
      ['OCR sobre PDF de servicios públicos', 'Régimen especial: sin IVA', 'Validación cruzada contra extracto'],
      XML_ENERGIA,
    ),
  );
  salida.push(
    preCompra(
      altavista, eaab, 'Acueducto y alcantarillado', '513530', rubro('altavista', 'SPU'),
      1_845_900, 0, '2026-11-09', 'EAAB-55671', 89.6, 'AGENTE_IA_OCR',
      ['OCR sobre PDF de servicios públicos', 'ReteICA 0,966%'],
      XML_ACUEDUCTO,
    ),
  );
  salida.push(
    preSoporte(altavista, jardinero, 850_000, '2026-11-14', 'DS-2026-118', 95.0),
  );
  salida.push(
    preHonorarios(altavista, revisor, 1_800_000, '2026-11-10', 'HON-2026-11-007', 96.8),
  );
  salida.push(
    preRecibo(altavista, u402, 'Bre-B', 'BRB-20261105-0042', cuota402, round100((cuota402 * altavista.descuentoProntoPagoPct) / 100), 0, '2026-11-05', 99.8),
  );
  salida.push(
    preRecibo(altavista, u601, 'PSE', 'PSE-20261106-0118', cuota601, 0, round100(cuota601 * altavista.tasaMoraMensual * 2), '2026-11-06', 99.2),
  );

  // Colina Campestre
  const colina = porId.get('colina')!;
  const uColina = unidad('colina-BloqueA-201');
  salida.push(
    preCompra(
      colina, atlas, 'Vigilancia y seguridad', '513505', rubro('colina', 'VIG'),
      round1000(18_500_000 * colina.escala), 19, '2026-11-02', 'FA-2026-11-00211', 96.9, 'AGENTE_IA_DIAN',
      ['XML UBL 2.1 validado contra la DIAN', 'IVA 19% sobre AIU'],
      XML_VIGILANCIA.replace('FA-2026-11-00842', 'FA-2026-11-00211').replace('900412887', '900412887'),
    ),
  );
  salida.push(
    preCompra(
      colina, PROVEEDOR_MAP['prov-elevadores'], 'Mantenimiento de ascensores', '514505', rubro('colina', 'ASC'),
      round1000(2_450_000 * colina.escala), 19, '2026-11-05', 'ELE-2026-11-0064', 93.7, 'AGENTE_IA_OCR',
      ['OCR sobre factura de mantenimiento', 'IVA 19%'],
    ),
  );
  salida.push(
    preRecibo(colina, uColina, 'Bre-B', 'BRB-20261105-0019', cuotaMensual(colina, uColina), 0, 0, '2026-11-05', 99.7),
  );

  // Plaza Norte
  const plaza = porId.get('plaza-norte')!;
  const uPlaza = unidad('plaza-norte-Etapa1-101');
  salida.push(
    preCompra(
      plaza, PROVEEDOR_MAP['prov-limpieza'], 'Aseo y cafetería', '513510', rubro('plaza-norte', 'ASE'),
      round1000(4_800_000 * plaza.escala), 19, '2026-11-03', 'LIM-2026-11-0033', 94.2, 'AGENTE_IA_OCR',
      ['OCR sobre factura de aseo', 'IVA 19%'],
    ),
  );
  salida.push(
    preCompra(
      plaza, PROVEEDOR_MAP['prov-seguros'], 'Póliza de áreas comunes', '513010', rubro('plaza-norte', 'SEG'),
      round1000(950_000 * plaza.escala), 19, '2026-11-12', 'SEG-2026-11-0027', 97.1, 'AGENTE_IA_DIAN',
      ['XML UBL 2.1 validado contra la DIAN'],
    ),
  );
  salida.push(
    preRecibo(plaza, uPlaza, 'PSE', 'PSE-20261107-0066', cuotaMensual(plaza, uPlaza), 0, 0, '2026-11-07', 99.5),
  );

  return salida;
}

// ── Ensamblaje final ───────────────────────────────────────────────────────
export interface SeedData {
  companies: Copropiedad[];
  units: Unidad[];
  terceros: Tercero[];
  rubros: Rubro[];
  comprobantes: Comprobante[];
  preAsientos: PreAsiento[];
}

export function buildSeed(): SeedData {
  lineaSeq = 0;
  const companies: Copropiedad[] = [];
  const units: Unidad[] = [];
  const terceros: Tercero[] = [...PROVEEDORES];
  const rubros: Rubro[] = [];
  const comprobantes: Comprobante[] = [];

  for (const def of EMPRESA_DEFS) {
    const rnd = mulberry32(hashSeed(def.id));
    const { unidades, terceros: ts } = buildUnidadesYTerceros(def, rnd);
    const empresaRubros = buildRubros(def.id, def.escala);
    const empresa: Copropiedad = {
      id: def.id,
      nit: def.nit,
      razonSocial: def.razonSocial,
      nombreCorto: def.nombreCorto,
      sigla: def.sigla,
      ciudad: def.ciudad,
      direccion: def.direccion,
      grupoNiif: def.grupoNiif,
      fondoImprevistosPct: 1,
      tasaMoraMensual: 1.5,
      diaCorteProntoPago: 10,
      descuentoProntoPagoPct: 2,
      llaveBreB: `+57 300 ${def.id === 'altavista' ? '555 0142' : def.id === 'colina' ? '555 0218' : '555 0367'}`,
      presupuestoAnual: presupuestoDe(empresaRubros),
      periodoActual: PERIODO_ACTUAL,
      saldosIniciales: buildSaldos(def.escala),
      escala: def.escala,
      color: def.color,
    };
    companies.push(empresa);
    units.push(...unidades);
    terceros.push(...ts);
    rubros.push(...empresaRubros);

    const ctx: Ctx = {
      empresa,
      unidades,
      terceros,
      rubros: empresaRubros,
      rnd,
      consecutivos: {},
      comprobantes,
    };
    generarComprobantes(ctx);
  }

  const preAsientos = buildPreAsientos(companies, units, rubros);

  return { companies, units, terceros, rubros, comprobantes, preAsientos };
}

export const PERIODOS_CERRADOS: Record<string, string[]> = {
  altavista: ['2026-09', '2026-10'],
  colina: ['2026-09', '2026-10'],
  'plaza-norte': ['2026-09', '2026-10'],
};
