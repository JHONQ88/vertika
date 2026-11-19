import type {
  AsientoValidacion,
  Comprobante,
  Copropiedad,
  Linea,
  PreAsiento,
  Rubro,
  Tercero,
  Unidad,
} from './types';
import { CUENTAS, CUENTA_MAP } from './puc';
import { diasVencido, fmtMoney } from './format';

const round100 = (n: number) => Math.round(n / 100) * 100;
const estaActivo = (c: Comprobante) => c.estado !== 'ANULADO';

export function totalesLineas(lineas: Linea[]): { debito: number; credito: number } {
  return {
    debito: lineas.reduce((s, l) => s + l.debito, 0),
    credito: lineas.reduce((s, l) => s + l.credito, 0),
  };
}

export function validarAsiento(lineas: Linea[]): AsientoValidacion {
  const errores: string[] = [];
  const { debito, credito } = totalesLineas(lineas);

  if (lineas.length < 2) errores.push('El comprobante debe tener al menos 2 líneas.');

  lineas.forEach((l, i) => {
    const n = i + 1;
    if (!CUENTA_MAP[l.cuenta]) errores.push(`Línea ${n}: la cuenta ${l.cuenta} no existe en el PUC ESAL.`);
    if (!Number.isFinite(l.debito) || !Number.isFinite(l.credito) || l.debito < 0 || l.credito < 0) {
      errores.push(`Línea ${n}: los montos no pueden ser negativos ni inválidos.`);
      return;
    }
    if (l.debito > 0 && l.credito > 0) errores.push(`Línea ${n}: no puede tener débito y crédito simultáneos.`);
    if (l.debito === 0 && l.credito === 0) errores.push(`Línea ${n}: el monto debe ser mayor a cero.`);
  });

  const diferencia = Math.round((debito - credito) * 100) / 100;
  if (diferencia !== 0) {
    errores.push(`El comprobante está descuadrado: débitos ${fmtMoney(debito)} ≠ créditos ${fmtMoney(credito)}.`);
  }

  return { ok: errores.length === 0, totalDebito: debito, totalCredito: credito, diferencia, errores };
}

export function proximoConsecutivo(comprobantes: Comprobante[], empresaId: string, tipo: string): number {
  return (
    Math.max(
      0,
      ...comprobantes
        .filter((c) => c.empresaId === empresaId && c.tipo === tipo)
        .map((c) => c.consecutivo),
    ) + 1
  );
}

// ── Libro auxiliar ─────────────────────────────────────────────────────────
export interface FilaLibro {
  comprobante: Comprobante;
  linea: Linea;
  fecha: string;
  periodo: string;
  consecutivo: number;
  tipo: string;
  cuenta: string;
  nombreCuenta: string;
  descripcion: string;
  debito: number;
  credito: number;
  terceroId?: string;
  unidadId?: string;
  origen: Comprobante['origen'];
}

export function filasLibro(
  comprobantes: Comprobante[],
  empresaId: string,
  periodo: string | 'todos',
  filtro?: { cuenta?: string; terceroId?: string; unidadId?: string },
): FilaLibro[] {
  const filas: FilaLibro[] = [];
  for (const c of comprobantes) {
    if (!estaActivo(c) || c.empresaId !== empresaId) continue;
    if (periodo !== 'todos' && c.periodo !== periodo) continue;
    for (const l of c.lineas) {
      if (filtro?.cuenta && l.cuenta !== filtro.cuenta) continue;
      if (filtro?.terceroId && l.terceroId !== filtro.terceroId) continue;
      if (filtro?.unidadId && l.unidadId !== filtro.unidadId) continue;
      filas.push({
        comprobante: c,
        linea: l,
        fecha: c.fecha,
        periodo: c.periodo,
        consecutivo: c.consecutivo,
        tipo: c.tipo,
        cuenta: l.cuenta,
        nombreCuenta: CUENTA_MAP[l.cuenta]?.nombre ?? 'Cuenta no encontrada',
        descripcion: l.descripcion,
        debito: l.debito,
        credito: l.credito,
        terceroId: l.terceroId,
        unidadId: l.unidadId,
        origen: c.origen,
      });
    }
  }
  return filas.sort((a, b) =>
    a.fecha === b.fecha
      ? a.consecutivo - b.consecutivo || a.linea.id.localeCompare(b.linea.id)
      : a.fecha.localeCompare(b.fecha),
  );
}

export function saldoCuenta(
  comprobantes: Comprobante[],
  empresa: Copropiedad,
  cuenta: string,
  hastaPeriodo: string | 'todos',
): number {
  const inicial = empresa.saldosIniciales[cuenta] ?? 0;
  const naturaleza = CUENTA_MAP[cuenta]?.naturaleza ?? 'D';
  let debito = 0;
  let credito = 0;
  for (const c of comprobantes) {
    if (!estaActivo(c) || c.empresaId !== empresa.id) continue;
    if (hastaPeriodo !== 'todos' && c.periodo > hastaPeriodo) continue;
    for (const l of c.lineas) {
      if (l.cuenta !== cuenta) continue;
      debito += l.debito;
      credito += l.credito;
    }
  }
  return naturaleza === 'D' ? inicial + debito - credito : inicial + credito - debito;
}

// ── Balance de prueba ──────────────────────────────────────────────────────
export interface FilaBalance {
  codigo: string;
  nombre: string;
  tipo: string;
  naturaleza: 'D' | 'C';
  saldoAnterior: number;
  debitos: number;
  creditos: number;
  saldoActual: number;
}

export interface BalanceResultado {
  filas: FilaBalance[];
  totalSaldoAnterior: number;
  totalDebitos: number;
  totalCreditos: number;
  totalSaldoActual: number;
  cuadra: boolean;
}

export function balancePrueba(
  comprobantes: Comprobante[],
  empresa: Copropiedad,
  periodo: string | 'todos',
): BalanceResultado {
  const filas: FilaBalance[] = [];
  for (const cuenta of CUENTAS) {
    const inicial = empresa.saldosIniciales[cuenta.codigo] ?? 0;
    let debitosPeriodo = 0;
    let creditosPeriodo = 0;
    let debitosAntes = 0;
    let creditosAntes = 0;

    for (const c of comprobantes) {
      if (!estaActivo(c) || c.empresaId !== empresa.id) continue;
      if (hastaPeriodoIncluido(c.periodo, periodo)) {
        for (const l of c.lineas) {
          if (l.cuenta !== cuenta.codigo) continue;
          if (periodo !== 'todos' && c.periodo === periodo) {
            debitosPeriodo += l.debito;
            creditosPeriodo += l.credito;
          } else if (c.periodo < periodo) {
            debitosAntes += l.debito;
            creditosAntes += l.credito;
          }
        }
      }
    }

    const saldoAnterior =
      cuenta.naturaleza === 'D' ? inicial + debitosAntes - creditosAntes : inicial + creditosAntes - debitosAntes;
    const saldoActual =
      cuenta.naturaleza === 'D'
        ? saldoAnterior + debitosPeriodo - creditosPeriodo
        : saldoAnterior + creditosPeriodo - debitosPeriodo;

    if (inicial === 0 && debitosPeriodo === 0 && creditosPeriodo === 0 && debitosAntes === 0 && creditosAntes === 0) {
      continue;
    }

    filas.push({
      codigo: cuenta.codigo,
      nombre: cuenta.nombre,
      tipo: cuenta.tipo,
      naturaleza: cuenta.naturaleza,
      saldoAnterior,
      debitos: debitosPeriodo,
      creditos: creditosPeriodo,
      saldoActual,
    });
  }

  const totalDebitos = filas.reduce((s, f) => s + f.debitos, 0);
  const totalCreditos = filas.reduce((s, f) => s + f.creditos, 0);
  const totalSaldoAnterior = filas.reduce(
    (s, f) => s + (f.naturaleza === 'D' ? f.saldoAnterior : -f.saldoAnterior),
    0,
  );
  // La columna de saldo está firmada por naturaleza: activo/gasto positivo,
  // pasivo/patrimonio/ingreso positivo. El neto contable debe ser cero.
  const totalSaldoActual = filas.reduce(
    (s, f) => s + (f.naturaleza === 'D' ? f.saldoActual : -f.saldoActual),
    0,
  );
  const cuadra =
    Math.abs(totalDebitos - totalCreditos) < 0.01 && Math.abs(totalSaldoActual) < 0.01;

  return {
    filas,
    totalSaldoAnterior,
    totalDebitos,
    totalCreditos,
    totalSaldoActual,
    cuadra,
  };
}

function hastaPeriodoIncluido(p: string, limite: string | 'todos'): boolean {
  return limite === 'todos' || p <= limite;
}

// ── Ejecución presupuestal ─────────────────────────────────────────────────
export interface FilaEjecucion {
  rubro: Rubro;
  presupuesto: number;
  ejecutado: number;
  disponible: number;
  pct: number;
  esperadoPct: number;
  estado: 'normal' | 'alerta' | 'critico';
}

export function ejecucionPresupuestal(
  comprobantes: Comprobante[],
  empresa: Copropiedad,
  rubros: Rubro[],
  periodo: string,
): FilaEjecucion[] {
  const anio = periodo.split('-')[0];
  const mes = Number(periodo.split('-')[1]);
  const esperadoPct = (mes / 12) * 100;

  return rubros
    .map((rubro) => {
      let ejecutado = 0;
      for (const c of comprobantes) {
        if (!estaActivo(c) || c.empresaId !== empresa.id) continue;
        if (!c.periodo.startsWith(anio)) continue;
        if (c.periodo > periodo) continue;
        for (const l of c.lineas) {
          const cuenta = CUENTA_MAP[l.cuenta];
          if (!cuenta || cuenta.tipo !== 'GASTO') continue;
          const aplica = l.rubroId ? l.rubroId === rubro.id : cuenta.rubroKey === rubro.key;
          if (!aplica) continue;
          ejecutado += l.debito - l.credito;
        }
      }
      const pct = rubro.presupuestoAnual > 0 ? (ejecutado / rubro.presupuestoAnual) * 100 : 0;
      const estado: FilaEjecucion['estado'] =
        pct >= 100 ? 'critico' : pct >= 90 || pct > esperadoPct + 15 ? 'alerta' : 'normal';
      return {
        rubro,
        presupuesto: rubro.presupuestoAnual,
        ejecutado: round100(ejecutado),
        disponible: round100(rubro.presupuestoAnual - ejecutado),
        pct: Math.round(pct * 10) / 10,
        esperadoPct,
        estado,
      };
    })
    .sort((a, b) => b.pct - a.pct);
}

// ── Cartera ────────────────────────────────────────────────────────────────
export interface FilaCartera {
  unidad: Unidad;
  propietario: Tercero | undefined;
  arrendatario: Tercero | undefined;
  coeficiente: number;
  cuota: number;
  cargado: number;
  pagado: number;
  saldo: number;
  mesesMora: number;
  diasVencido: number;
  periodoMasAntiguo: string | null;
  estado: 'AL_DIA' | 'EN_MORA' | 'CONGELADA' | 'POR_VENCER';
}

export const CUENTAS_CARTERA = ['130505', '130510', '130515', '130520'];

export function cartera(
  comprobantes: Comprobante[],
  empresa: Copropiedad,
  unidades: Unidad[],
  terceros: Tercero[],
  periodo: string,
): FilaCartera[] {
  const periodos = Array.from(
    new Set(
      comprobantes
        .filter((c) => estaActivo(c) && c.empresaId === empresa.id && c.periodo <= periodo)
        .map((c) => c.periodo),
    ),
  ).sort();

  return unidades.map((unidad) => {
    let cargado = 0;
    let pagado = 0;
    let saldoPorPeriodo = 0;
    let periodoMasAntiguo: string | null = null;
    let mesesMora = 0;

    for (const p of periodos) {
      let cargo = 0;
      let abono = 0;
      for (const c of comprobantes) {
        if (!estaActivo(c) || c.empresaId !== empresa.id || c.periodo !== p) continue;
        for (const l of c.lineas) {
          if (l.unidadId !== unidad.id) continue;
          if (!CUENTAS_CARTERA.includes(l.cuenta)) continue;
          cargo += l.debito;
          abono += l.credito;
        }
      }
      cargado += cargo;
      pagado += abono;
      saldoPorPeriodo += cargo - abono;
      if (saldoPorPeriodo <= 0.01) {
        periodoMasAntiguo = null;
        mesesMora = 0;
      } else if (periodoMasAntiguo === null) {
        periodoMasAntiguo = p;
        mesesMora = diasVencido(p, periodo);
      }
    }

    const saldo = round100(cargado - pagado);
    if (saldo <= 0.01) {
      periodoMasAntiguo = null;
      mesesMora = 0;
    }
    let estado: FilaCartera['estado'] = 'AL_DIA';
    if (saldo > 0.01) {
      if (unidad.carteraCongelada) estado = 'CONGELADA';
      else if (periodoMasAntiguo && periodoMasAntiguo < periodo) estado = 'EN_MORA';
      else estado = 'POR_VENCER';
    }

    return {
      unidad,
      propietario: terceros.find((t) => t.id === unidad.propietarioId),
      arrendatario: unidad.arrendatarioId ? terceros.find((t) => t.id === unidad.arrendatarioId) : undefined,
      coeficiente: unidad.coeficiente,
      cuota: 0,
      cargado: round100(cargado),
      pagado: round100(pagado),
      saldo,
      mesesMora,
      diasVencido: saldo > 0.01 && periodoMasAntiguo ? mesesMora * 30 + 10 : 0,
      periodoMasAntiguo,
      estado,
    };
  });
}

// ── Cierre mensual ─────────────────────────────────────────────────────────
export interface CierrePreview {
  depreciacion: number;
  provision: number;
  trasladoFondo: number;
  carteraTotal: number;
}

export function previewCierre(
  comprobantes: Comprobante[],
  empresa: Copropiedad,
  unidades: Unidad[],
  terceros: Tercero[],
  periodo: string,
): CierrePreview {
  const rows = cartera(comprobantes, empresa, unidades, terceros, periodo);
  const carteraTotal = rows.reduce((s, r) => s + r.saldo, 0);
  let trasladoFondo = 0;
  for (const c of comprobantes) {
    if (!estaActivo(c) || c.empresaId !== empresa.id || c.periodo !== periodo) continue;
    for (const l of c.lineas) {
      if (l.cuenta === '281510' && l.credito > 0) trasladoFondo += l.credito;
    }
  }
  return {
    depreciacion: round100(2_500_000 * empresa.escala),
    provision: round100(carteraTotal * 0.05),
    trasladoFondo: round100(trasladoFondo),
    carteraTotal: round100(carteraTotal),
  };
}

export function lineasCierre(
  _empresa: Copropiedad,
  periodo: string,
  preview: CierrePreview,
  rubros: Rubro[],
): Linea[] {
  const rubro = (key: string) => rubros.find((r) => r.key === key)?.id;
  const lineas: Linea[] = [];
  if (preview.depreciacion > 0) {
    lineas.push(
      { id: `cie-${periodo}-1`, cuenta: '516005', descripcion: 'Depreciación de PP&E', debito: preview.depreciacion, credito: 0, rubroId: rubro('MAN') },
      { id: `cie-${periodo}-2`, cuenta: '159215', descripcion: 'Depreciación acumulada', debito: 0, credito: preview.depreciacion },
    );
  }
  if (preview.provision > 0) {
    lineas.push(
      { id: `cie-${periodo}-3`, cuenta: '519905', descripcion: 'Provisión deterioro de cartera', debito: preview.provision, credito: 0, rubroId: rubro('FIN') },
      { id: `cie-${periodo}-4`, cuenta: '139905', descripcion: 'Deterioro de cartera', debito: 0, credito: preview.provision },
    );
  }
  if (preview.trasladoFondo > 0) {
    lineas.push(
      { id: `cie-${periodo}-5`, cuenta: '111010', descripcion: 'Bancos - Fondo de imprevistos', debito: preview.trasladoFondo, credito: 0 },
      { id: `cie-${periodo}-6`, cuenta: '111005', descripcion: 'Bancos - cuenta recaudadora', debito: 0, credito: preview.trasladoFondo },
    );
  }
  return lineas;
}

// ── Acarreo IA (autocompletado determinista de retenciones) ────────────────
let acarreoSeq = 0;

export function acarrearPreAsiento(
  pre: PreAsiento,
  terceros: Tercero[],
): { lineas: Linea[]; detalle: string } | null {
  const provider = terceros.find((t) => t.id === pre.terceroId);
  if (!provider) return null;

  const gastoLines = pre.lineas.filter(
    (l) =>
      Number.isFinite(l.debito) &&
      l.debito > 0 &&
      l.cuenta !== '135515' &&
      l.cuenta !== '111005' &&
      l.cuenta !== '417035',
  );
  const ivaLines = pre.lineas.filter(
    (l) => Number.isFinite(l.debito) && l.debito > 0 && l.cuenta === '135515',
  );
  if (gastoLines.length === 0) return null;

  const baseRaw = gastoLines.reduce((s, l) => s + l.debito, 0);
  const ivaRaw = ivaLines.reduce((s, l) => s + l.debito, 0);

  if (provider.retefuentePct === 0 && provider.reteicaPct === 0 && provider.reteivaPct === 0) {
    return null;
  }

  const rf = round100((baseRaw * provider.retefuentePct) / 100);
  const ri = round100((baseRaw * provider.reteicaPct) / 100);
  const riva = round100((ivaRaw * provider.reteivaPct) / 100);
  const neto = Math.round((baseRaw + ivaRaw - rf - ri - riva) * 100) / 100;
  if (neto < 0) return null;

  const nuevas: Linea[] = [...gastoLines, ...ivaLines];

  if (neto > 0) {
    const netoOriginal = pre.lineas.find((l) => l.cuenta === '220505');
    nuevas.push({
      id: netoOriginal?.id ?? `ac-${++acarreoSeq}`,
      cuenta: '220505',
      descripcion: 'Cuenta por pagar',
      debito: 0,
      credito: neto,
      terceroId: provider.id,
    });
  }

  const retenciones: Array<[string, string, number]> = [
    ['236540', 'Retención en la fuente', rf],
    ['236801', 'Retención de ICA', ri],
    ['236705', 'Retención de IVA', riva],
  ];
  for (const [cuenta, nombre, valor] of retenciones) {
    if (valor > 0) {
      const original = pre.lineas.find((l) => l.cuenta === cuenta);
      nuevas.push({
        id: original?.id ?? `ac-${++acarreoSeq}`,
        cuenta,
        descripcion: nombre,
        debito: 0,
        credito: valor,
      });
    }
  }

  const partes: string[] = [];
  if (rf > 0) partes.push(`ReteFuente ${provider.retefuentePct}% = ${fmtMoney(rf)}`);
  if (ri > 0) partes.push(`ReteICA ${provider.reteicaPct}% = ${fmtMoney(ri)}`);
  if (riva > 0) partes.push(`ReteIVA ${provider.reteivaPct}% = ${fmtMoney(riva)}`);
  return {
    lineas: nuevas,
    detalle: `Acarreo IA: ${partes.join(' · ')}. Neto a pagar ${fmtMoney(neto)}.`,
  };
}

// ── Resumen de periodo ─────────────────────────────────────────────────────
export interface ResumenPeriodo {
  facturado: number;
  recaudado: number;
  descuentos: number;
  gastos: number;
  causado: number;
  cartera: number;
  unidadesAlDia: number;
  unidadesEnMora: number;
}

export function resumenPeriodo(
  comprobantes: Comprobante[],
  empresa: Copropiedad,
  unidades: Unidad[],
  terceros: Tercero[],
  periodo: string,
): ResumenPeriodo {
  let facturado = 0;
  let recaudado = 0;
  let descuentos = 0;
  let gastos = 0;
  for (const c of comprobantes) {
    if (!estaActivo(c) || c.empresaId !== empresa.id || c.periodo !== periodo) continue;
    for (const l of c.lineas) {
      if (l.cuenta === '417005' && l.credito > 0) facturado += l.credito;
      if (l.cuenta === '111005' && l.debito > 0) recaudado += l.debito;
      if (l.cuenta === '417035' && l.debito > 0) descuentos += l.debito;
      if (CUENTA_MAP[l.cuenta]?.tipo === 'GASTO' && l.debito > 0) gastos += l.debito;
    }
  }
  const rows = cartera(comprobantes, empresa, unidades, terceros, periodo);
  return {
    facturado: round100(facturado),
    recaudado: round100(recaudado),
    descuentos: round100(descuentos),
    gastos: round100(gastos),
    causado: round100(gastos),
    cartera: round100(rows.reduce((s, r) => s + r.saldo, 0)),
    unidadesAlDia: rows.filter((r) => r.saldo <= 0.01).length,
    unidadesEnMora: rows.filter((r) => r.saldo > 0.01).length,
  };
}
