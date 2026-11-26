import type { Comprobante, Copropiedad, Tercero } from './types';
import { CUENTA_MAP } from './puc';
import { balancePrueba, type FilaEjecucion, type FilaCartera } from './engine';
import { fmtFecha, fmtMoney, fmtPeriodo, fmtPeriodoLargo, hoyISO } from './format';

export interface LineaEstadoFinanciero {
  codigo: string;
  nombre: string;
  naturaleza: 'D' | 'C';
  saldo: number;
  contra?: boolean;
}

export interface EstadoSituacionFinanciera {
  activos: LineaEstadoFinanciero[];
  pasivos: LineaEstadoFinanciero[];
  patrimonio: LineaEstadoFinanciero[];
  totalActivos: number;
  totalPasivos: number;
  patrimonioBase: number;
  excedenteEjercicio: number;
  totalPatrimonio: number;
  cuadra: boolean;
}

export interface EstadoResultados {
  ingresos: LineaEstadoFinanciero[];
  gastos: LineaEstadoFinanciero[];
  totalIngresos: number;
  totalGastos: number;
  excedente: number;
}

export interface CertificadoRetencionFila {
  terceroId: string;
  nombre: string;
  documento: string;
  basePagada: number;
  retefuente: number;
  reteica: number;
  reteiva: number;
  totalRetenido: number;
}

export function estadoSituacionFinanciera(
  comprobantes: Comprobante[],
  empresa: Copropiedad,
  periodo: string,
): EstadoSituacionFinanciera {
  const bal = balancePrueba(comprobantes, empresa, periodo);

  const activos: LineaEstadoFinanciero[] = [];
  const pasivos: LineaEstadoFinanciero[] = [];
  const patrimonio: LineaEstadoFinanciero[] = [];

  let totalActivos = 0;
  let totalPasivos = 0;
  let patrimonioBase = 0;
  let ingresosNeto = 0;
  let gastosNeto = 0;

  for (const f of bal.filas) {
    if (f.tipo === 'ACTIVO') {
      const signo = f.naturaleza === 'D' ? 1 : -1;
      totalActivos += signo * f.saldoActual;
      activos.push({
        codigo: f.codigo,
        nombre: f.nombre,
        naturaleza: f.naturaleza,
        saldo: f.saldoActual,
        contra: f.naturaleza === 'C',
      });
    } else if (f.tipo === 'PASIVO') {
      const signo = f.naturaleza === 'C' ? 1 : -1;
      totalPasivos += signo * f.saldoActual;
      pasivos.push({
        codigo: f.codigo,
        nombre: f.nombre,
        naturaleza: f.naturaleza,
        saldo: f.saldoActual,
        contra: f.naturaleza === 'D',
      });
    } else if (f.tipo === 'PATRIMONIO') {
      const signo = f.naturaleza === 'C' ? 1 : -1;
      patrimonioBase += signo * f.saldoActual;
      patrimonio.push({
        codigo: f.codigo,
        nombre: f.nombre,
        naturaleza: f.naturaleza,
        saldo: f.saldoActual,
        contra: f.naturaleza === 'D',
      });
    } else if (f.tipo === 'INGRESO') {
      ingresosNeto += (f.naturaleza === 'C' ? 1 : -1) * f.saldoActual;
    } else if (f.tipo === 'GASTO') {
      gastosNeto += (f.naturaleza === 'D' ? 1 : -1) * f.saldoActual;
    }
  }

  const excedenteEjercicio = ingresosNeto - gastosNeto;
  const totalPatrimonio = patrimonioBase + excedenteEjercicio;
  const cuadra = Math.abs(totalActivos - (totalPasivos + totalPatrimonio)) < 0.01;

  return {
    activos,
    pasivos,
    patrimonio,
    totalActivos,
    totalPasivos,
    patrimonioBase,
    excedenteEjercicio,
    totalPatrimonio,
    cuadra,
  };
}

export function estadoResultados(
  comprobantes: Comprobante[],
  empresa: Copropiedad,
  periodo: string,
): EstadoResultados {
  const anio = periodo.split('-')[0];
  const mapa = new Map<string, number>();

  for (const c of comprobantes) {
    if (c.estado === 'ANULADO' || c.empresaId !== empresa.id) continue;
    if (periodo !== 'todos' && (!c.periodo.startsWith(anio) || c.periodo > periodo)) continue;
    for (const l of c.lineas) {
      const cta = CUENTA_MAP[l.cuenta];
      if (!cta || (cta.tipo !== 'INGRESO' && cta.tipo !== 'GASTO')) continue;
      const delta = cta.naturaleza === 'C' ? l.credito - l.debito : l.debito - l.credito;
      mapa.set(l.cuenta, (mapa.get(l.cuenta) ?? 0) + delta);
    }
  }

  const ingresos: LineaEstadoFinanciero[] = [];
  const gastos: LineaEstadoFinanciero[] = [];
  let totalIngresos = 0;
  let totalGastos = 0;

  for (const [codigo, saldo] of Array.from(mapa.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (Math.abs(saldo) < 0.01) continue;
    const cta = CUENTA_MAP[codigo];
    if (!cta) continue;
    if (cta.tipo === 'INGRESO') {
      const signo = cta.naturaleza === 'C' ? 1 : -1;
      totalIngresos += signo * saldo;
      ingresos.push({
        codigo,
        nombre: cta.nombre,
        naturaleza: cta.naturaleza,
        saldo,
        contra: cta.naturaleza === 'D',
      });
    } else {
      const signo = cta.naturaleza === 'D' ? 1 : -1;
      totalGastos += signo * saldo;
      gastos.push({
        codigo,
        nombre: cta.nombre,
        naturaleza: cta.naturaleza,
        saldo,
        contra: cta.naturaleza === 'C',
      });
    }
  }

  return {
    ingresos,
    gastos,
    totalIngresos,
    totalGastos,
    excedente: totalIngresos - totalGastos,
  };
}

export function certificadosRetencion(
  comprobantes: Comprobante[],
  empresa: Copropiedad,
  terceros: Tercero[],
  anio: string,
): CertificadoRetencionFila[] {
  const mapa = new Map<string, CertificadoRetencionFila>();
  const ensureRow = (tpId: string): CertificadoRetencionFila => {
    const existing = mapa.get(tpId);
    if (existing) return existing;
    const tp = terceros.find((t) => t.id === tpId);
    const created: CertificadoRetencionFila = {
      terceroId: tpId,
      nombre: tp?.nombre ?? 'Tercero no identificado',
      documento: tp ? `${tp.documento}${tp.dv ? `-${tp.dv}` : ''}` : 'N/A',
      basePagada: 0,
      retefuente: 0,
      reteica: 0,
      reteiva: 0,
      totalRetenido: 0,
    };
    mapa.set(tpId, created);
    return created;
  };

  for (const c of comprobantes) {
    if (c.estado === 'ANULADO' || c.empresaId !== empresa.id || !c.periodo.startsWith(anio)) continue;
    const fallbackTp = c.lineas.find((l) => l.terceroId)?.terceroId;
    let gastoComp = 0;
    let rfComp = 0;
    let riComp = 0;
    let rivaComp = 0;

    for (const l of c.lineas) {
      const cta = CUENTA_MAP[l.cuenta];
      if (cta?.tipo === 'GASTO' && l.debito > 0) gastoComp += l.debito;
      if (l.cuenta === '236540' && l.credito > 0) rfComp += l.credito;
      if (l.cuenta === '236801' && l.credito > 0) riComp += l.credito;
      if (l.cuenta === '236705' && l.credito > 0) rivaComp += l.credito;
    }

    if (rfComp === 0 && riComp === 0 && rivaComp === 0) continue;
    const row = ensureRow(fallbackTp ?? 'sin-tercero');
    row.basePagada += gastoComp;
    row.retefuente += rfComp;
    row.reteica += riComp;
    row.reteiva += rivaComp;
    row.totalRetenido += rfComp + riComp + rivaComp;
  }

  return Array.from(mapa.values()).sort((a, b) => b.totalRetenido - a.totalRetenido);
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escXml(s: string): string {
  return escHtml(s).replace(/'/g, '&apos;');
}

export function generarPazYSalvoHTML(
  empresa: Copropiedad,
  fila: FilaCartera,
  periodo: string,
): string {
  const fecha = fmtFecha(hoyISO());
  const unidad = `${fila.unidad.torre} ${fila.unidad.numero}`;
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Paz y Salvo - ${escHtml(unidad)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 48px; color: #111827; line-height: 1.55; }
  .box { max-width: 720px; margin: 0 auto; border: 1px solid #d1d5db; border-radius: 10px; padding: 36px; }
  h1 { margin: 0 0 4px; font-size: 20px; text-transform: uppercase; letter-spacing: .5px; }
  .sub { color: #4b5563; font-size: 13px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
  td, th { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
  th { background: #f9fafb; width: 38%; }
  .ok { display: inline-block; background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; padding: 4px 10px; border-radius: 6px; font-weight: 600; font-size: 13px; }
  .foot { margin-top: 32px; font-size: 12px; color: #6b7280; border-top: 1px dashed #d1d5db; padding-top: 12px; }
</style>
</head>
<body>
  <div class="box">
    <h1>Certificado de Paz y Salvo</h1>
    <div class="sub">${escHtml(empresa.razonSocial)} · NIT ${escHtml(empresa.nit)} · ${escHtml(empresa.ciudad)}</div>
    <p>La Administración de la copropiedad certifica, conforme al artículo 29 de la Ley 675 de 2001, que el inmueble detallado a continuación se encuentra <span class="ok">AL DÍA / PAZ Y SALVO</span> por concepto de expensas comunes ordinarias y extraordinarias hasta el periodo <strong>${escHtml(fmtPeriodoLargo(periodo))}</strong>.</p>
    <table>
      <tr><th>Unidad inmobiliaria</th><td>${escHtml(unidad)} (${escHtml(fila.unidad.tipo)})</td></tr>
      <tr><th>Matrícula inmobiliaria</th><td>${escHtml(fila.unidad.matricula)}</td></tr>
      <tr><th>Coeficiente de copropiedad</th><td>${fila.coeficiente.toFixed(6)}%</td></tr>
      <tr><th>Propietario</th><td>${escHtml(fila.propietario?.nombre ?? 'No registrado')} · ${escHtml(fila.propietario?.documento ?? '')}</td></tr>
      <tr><th>Saldo en cartera</th><td>${escHtml(fmtMoney(fila.saldo))}</td></tr>
      <tr><th>Fecha de expedición</th><td>${escHtml(fecha)}</td></tr>
    </table>
    <div class="foot">Generado por Vértika · Contabilidad determinista PUC ESAL · Periodo ${escHtml(fmtPeriodo(periodo))}.</div>
  </div>
</body>
</html>`;
}

export function generarEstadosFinancierosHTML(
  empresa: Copropiedad,
  periodo: string,
  esf: EstadoSituacionFinanciera,
  er: EstadoResultados,
): string {
  const renderRows = (rows: LineaEstadoFinanciero[]) =>
    rows
      .map(
        (r) =>
          `<tr><td><code>${escHtml(r.codigo)}</code></td><td>${escHtml(r.nombre)}${r.contra ? ' (CR)' : ''}</td><td style="text-align:right">${escHtml(fmtMoney(r.contra ? -r.saldo : r.saldo))}</td></tr>`,
      )
      .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Estados Financieros ESAL - ${escHtml(empresa.nombreCorto)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 36px; color: #111827; font-size: 13px; }
  h1 { margin: 0 0 4px; font-size: 19px; }
  h2 { margin: 24px 0 8px; font-size: 15px; border-bottom: 2px solid #111827; padding-bottom: 4px; }
  .sub { color: #4b5563; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }
  tfoot td { font-weight: 700; background: #f9fafb; border-top: 2px solid #9ca3af; }
</style>
</head>
<body>
  <h1>${escHtml(empresa.razonSocial)}</h1>
  <div class="sub">NIT ${escHtml(empresa.nit)} · NIIF Grupo ${empresa.grupoNiif} (ESAL · OT-15 CTCP) · Corte a ${escHtml(fmtPeriodoLargo(periodo))}</div>

  <h2>1. Estado de Situación Financiera</h2>
  <table>
    <thead><tr><th>Cuenta</th><th>Concepto</th><th style="text-align:right">Saldo</th></tr></thead>
    <tbody>
      <tr><td colspan="3"><strong>ACTIVO</strong></td></tr>
      ${renderRows(esf.activos)}
      <tr><td colspan="2"><strong>Total Activo</strong></td><td style="text-align:right"><strong>${escHtml(fmtMoney(esf.totalActivos))}</strong></td></tr>
      <tr><td colspan="3"><strong>PASIVO</strong></td></tr>
      ${renderRows(esf.pasivos)}
      <tr><td colspan="2"><strong>Total Pasivo</strong></td><td style="text-align:right"><strong>${escHtml(fmtMoney(esf.totalPasivos))}</strong></td></tr>
      <tr><td colspan="3"><strong>PATRIMONIO</strong></td></tr>
      ${renderRows(esf.patrimonio)}
      <tr><td><code>360505</code></td><td>Excedente / (Déficit) del ejercicio acumulado</td><td style="text-align:right">${escHtml(fmtMoney(esf.excedenteEjercicio))}</td></tr>
    </tbody>
    <tfoot>
      <tr><td colspan="2">Total Pasivo + Patrimonio (${esf.cuadra ? 'Ecuación cuadrada' : 'Descuadre'})</td><td style="text-align:right">${escHtml(fmtMoney(esf.totalPasivos + esf.totalPatrimonio))}</td></tr>
    </tfoot>
  </table>

  <h2>2. Estado de Resultados Integral (Año ${escHtml(periodo.split('-')[0])})</h2>
  <table>
    <thead><tr><th>Cuenta</th><th>Concepto</th><th style="text-align:right">Valor</th></tr></thead>
    <tbody>
      <tr><td colspan="3"><strong>INGRESOS</strong></td></tr>
      ${renderRows(er.ingresos)}
      <tr><td colspan="2"><strong>Total Ingresos</strong></td><td style="text-align:right"><strong>${escHtml(fmtMoney(er.totalIngresos))}</strong></td></tr>
      <tr><td colspan="3"><strong>GASTOS</strong></td></tr>
      ${renderRows(er.gastos)}
      <tr><td colspan="2"><strong>Total Gastos</strong></td><td style="text-align:right"><strong>${escHtml(fmtMoney(er.totalGastos))}</strong></td></tr>
    </tbody>
    <tfoot>
      <tr><td colspan="2">Excedente / (Déficit) del periodo</td><td style="text-align:right">${escHtml(fmtMoney(er.excedente))}</td></tr>
    </tfoot>
  </table>
</body>
</html>`;
}

export function generarCertificadosRetencionHTML(
  empresa: Copropiedad,
  anio: string,
  filas: CertificadoRetencionFila[],
): string {
  const body =
    filas.length === 0
      ? '<tr><td colspan="6">Sin retenciones practicadas en el año seleccionado.</td></tr>'
      : filas
          .map(
            (f) => `<tr>
              <td>${escHtml(f.nombre)}</td>
              <td>${escHtml(f.documento)}</td>
              <td style="text-align:right">${escHtml(fmtMoney(f.basePagada))}</td>
              <td style="text-align:right">${escHtml(fmtMoney(f.retefuente))}</td>
              <td style="text-align:right">${escHtml(fmtMoney(f.reteica))}</td>
              <td style="text-align:right">${escHtml(fmtMoney(f.reteiva))}</td>
            </tr>`,
          )
          .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Certificados de Retención ${escHtml(anio)} - ${escHtml(empresa.nombreCorto)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 36px; color: #111827; font-size: 13px; }
  h1 { margin: 0 0 4px; font-size: 18px; }
  .sub { color: #4b5563; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #e5e7eb; padding: 7px 10px; text-align: left; }
  th { background: #f9fafb; }
</style>
</head>
<body>
  <h1>Certificado Anual Consolidado de Retenciones · Año Gravable ${escHtml(anio)}</h1>
  <div class="sub">Agente retenedor: ${escHtml(empresa.razonSocial)} · NIT ${escHtml(empresa.nit)} · ${escHtml(empresa.ciudad)}</div>
  <table>
    <thead>
      <tr>
        <th>Tercero retenido</th>
        <th>Documento / NIT</th>
        <th style="text-align:right">Base causada</th>
        <th style="text-align:right">ReteFuente</th>
        <th style="text-align:right">ReteICA</th>
        <th style="text-align:right">ReteIVA</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
</body>
</html>`;
}

export function generarMediosMagneticosXML(
  comprobantes: Comprobante[],
  empresa: Copropiedad,
  terceros: Tercero[],
  anio: string,
): string {
  const filas = certificadosRetencion(comprobantes, empresa, terceros, anio);
  const nitLimpio = empresa.nit.replace(/[^0-9]/g, '');
  const registros = filas
    .map((f) => {
      const docNum = f.documento.replace(/[^0-9]/g, '');
      return `    <pagos cpt="5016" tdoc="31" nid="${escXml(docNum)}" raz="${escXml(f.nombre)}" pabo="${Math.round(f.basePagada)}" rfte="${Math.round(f.retefuente)}" rica="${Math.round(f.reteica)}" riva="${Math.round(f.reteiva)}" />`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<mas xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Cab>
    <Ano>${escXml(anio)}</Ano>
    <CodCpt>1</CodCpt>
    <Formato>1001</Formato>
    <Version>10</Version>
    <NumEnvio>1</NumEnvio>
    <FecEnvio>${escXml(hoyISO())}</FecEnvio>
    <NitInformante>${escXml(nitLimpio)}</NitInformante>
    <RazSocInformante>${escXml(empresa.razonSocial)}</RazSocInformante>
    <CantReg>${filas.length}</CantReg>
  </Cab>
  <Contenido>
${registros}
  </Contenido>
</mas>`;
}

export function generarEjecucionPresupuestalCSV(filas: FilaEjecucion[]): string {
  const encabezado = ['Rubro', 'Cuenta', 'Centro de costo', 'Presupuesto anual', 'Ejecutado', 'Disponible', 'Avance %', 'Estado'];
  const lineas = filas.map((f) => [
    f.rubro.nombre,
    f.rubro.cuenta,
    f.rubro.centro,
    f.presupuesto,
    f.ejecutado,
    f.disponible,
    f.pct,
    f.estado,
  ]);
  const csv = [encabezado, ...lineas]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  return `\uFEFF${csv}`;
}

export function descargarArchivo(
  nombre: string,
  contenido: string,
  mime = 'text/plain;charset=utf-8',
) {
  const blob = new Blob([contenido], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

export function generarCuentaDeCobroHTML(params: {
  razonSocial: string;
  nit: string;
  ciudad: string;
  direccion: string;
  periodoActual: string;
  unidadLabel: string;
  propietarioNombre: string;
  propietarioDocumento: string;
  arrendatarioNombre?: string | null;
  cuotaMensual: number;
  cargadoTotal: number;
  pagadoTotal: number;
  saldoActual: number;
  descuentoProntoPago: number;
  totalConDescuento: number;
  diaCorteProntoPago: number;
  llaveBreB: string;
  linkPago?: string;
  movimientos: Array<{
    fecha: string;
    comprobante: string;
    descripcion: string;
    cargo: number;
    abono: number;
  }>;
}): string {
  const rows = params.movimientos
    .slice(0, 12)
    .map(
      (m) => `<tr>
        <td>${escHtml(fmtFecha(m.fecha))}</td>
        <td class="mono">${escHtml(m.comprobante)}</td>
        <td>${escHtml(m.descripcion)}</td>
        <td class="num mono">${m.cargo > 0 ? escHtml(fmtMoney(m.cargo)) : '—'}</td>
        <td class="num mono">${m.abono > 0 ? escHtml(fmtMoney(m.abono)) : '—'}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Cuenta de Cobro - ${escHtml(params.unidadLabel)} - ${escHtml(params.periodoActual)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 36px; color: #111113; line-height: 1.5; background: #fff; }
  .sheet { max-width: 760px; margin: 0 auto; border: 1px solid #e4e4e7; border-radius: 8px; padding: 28px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #e4e4e7; padding-bottom: 16px; gap: 16px; }
  h1 { margin: 0; font-size: 18px; letter-spacing: -0.02em; }
  .muted { color: #52525b; font-size: 12.5px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 18px 0; }
  .box { border: 1px solid #e4e4e7; border-radius: 6px; padding: 12px; background: #fafafa; }
  .box small { display: block; color: #52525b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .box strong { font-size: 16px; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 12.5px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #e4e4e7; text-align: left; }
  th { background: #f4f4f5; font-weight: 600; font-size: 11.5px; text-transform: uppercase; color: #52525b; }
  .num { text-align: right; }
  .mono { font-family: ui-monospace, SFMono-Regular, monospace; font-variant-numeric: tabular-nums; }
  .pay { margin-top: 18px; padding: 14px; border: 1px solid #0f766e; border-radius: 6px; background: #f0fdfa; font-size: 13px; }
  @media print { body { margin: 0; } .sheet { border: none; } }
</style>
</head>
<body>
  <div class="sheet">
    <div class="top">
      <div>
        <h1>${escHtml(params.razonSocial)}</h1>
        <div class="muted">NIT ${escHtml(params.nit)} · ${escHtml(params.direccion)} · ${escHtml(params.ciudad)}</div>
        <div class="muted">Entidad Sin Ánimo de Lucro · Ley 675 de 2001</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;text-transform:uppercase;color:#52525b;font-weight:700">Cuenta de Cobro</div>
        <div class="mono" style="font-size:15px;font-weight:700">${escHtml(params.unidadLabel)}</div>
        <div class="muted">Periodo ${escHtml(fmtPeriodo(params.periodoActual))} · Emitida ${escHtml(fmtFecha(hoyISO()))}</div>
      </div>
    </div>

    <div style="margin-top:14px;font-size:13px">
      <strong>Propietario:</strong> ${escHtml(params.propietarioNombre)} (${escHtml(params.propietarioDocumento)})
      ${params.arrendatarioNombre ? `<br/><strong>Arrendatario:</strong> ${escHtml(params.arrendatarioNombre)}` : ''}
    </div>

    <div class="grid">
      <div class="box">
        <small>Cuota ordinaria mensual</small>
        <strong class="mono">${escHtml(fmtMoney(params.cuotaMensual))}</strong>
      </div>
      <div class="box">
        <small>Saldo total a pagar</small>
        <strong class="mono" style="color:${params.saldoActual > 0 ? '#b45309' : '#0f766e'}">${escHtml(fmtMoney(params.saldoActual))}</strong>
      </div>
      <div class="box">
        <small>${params.descuentoProntoPago > 0 ? `Con pronto pago (hasta día ${params.diaCorteProntoPago})` : 'Total recaudado acumulado'}</small>
        <strong class="mono">${escHtml(fmtMoney(params.descuentoProntoPago > 0 ? params.totalConDescuento : params.pagadoTotal))}</strong>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Doc</th>
          <th>Concepto</th>
          <th class="num">Cargo</th>
          <th class="num">Abono</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="5">Sin movimientos recientes</td></tr>'}</tbody>
    </table>

    <div class="pay">
      <strong>Canales de pago habilitados:</strong><br/>
      ${params.llaveBreB ? `• <strong>Llave Bre-B / Transferencia:</strong> <span class="mono">${escHtml(params.llaveBreB)}</span> (indicar unidad ${escHtml(params.unidadLabel)})<br/>` : ''}
      ${params.linkPago ? `• <strong>Pago en línea (PSE / Nequi / Tarjeta):</strong> <a href="${escHtml(params.linkPago)}">${escHtml(params.linkPago)}</a>` : ''}
    </div>
  </div>
</body>
</html>`;
}
