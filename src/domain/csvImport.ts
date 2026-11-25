import type { CuentaPuc, Tercero } from './types';

export type CsvImportKind = 'unidades' | 'terceros' | 'saldos' | 'puc';

export interface PucCsvRow {
  codigo: string;
  nombre: string;
  tipo: CuentaPuc['tipo'];
  naturaleza: 'D' | 'C';
  requiereTercero: boolean;
  requiereUnidad: boolean;
  nota?: string;
}

export interface TerceroCsvRow {
  nombre: string;
  tipo: Tercero['tipo'];
  documento: string;
  dv?: string;
  email: string;
  telefono: string;
  ciudad: string;
  retefuentePct: number;
  reteicaPct: number;
  reteivaPct: number;
  noObligado: boolean;
}

export interface UnidadCsvRow {
  torre: string;
  numero: string;
  tipo: 'APARTAMENTO' | 'CASA' | 'LOCAL';
  area: number;
  coeficiente: number;
  matricula: string;
  propietarioNombre: string;
  propietarioDocumento: string;
  propietarioEmail: string;
  propietarioTelefono: string;
}

export interface SaldoInicialCsvRow {
  cuenta: string;
  terceroDocumento: string;
  unidadCodigo: string;
  descripcion: string;
  debito: number;
  credito: number;
}

export const PLANTILLA_UNIDADES_CSV = [
  'torre;numero;tipo;area;coeficiente;matricula;propietario_nombre;propietario_documento;propietario_email;propietario_telefono',
  'T1;101;APARTAMENTO;68;0.012500;50N-20101;Ana María Torres;52123456;ana.torres@correo.co;3001112233',
  'T1;102;APARTAMENTO;72;0.013200;50N-20102;Carlos Eduardo Ruiz;79654321;carlos.ruiz@correo.co;3102223344',
  'T2;201;LOCAL;45;0.009500;50N-20201;Inversiones Norte S.A.S.;900888777;gerencia@invnorte.co;3153334455',
].join('\r\n');

export const PLANTILLA_TERCEROS_CSV = [
  'nombre;tipo;documento;dv;email;telefono;ciudad;retefuentePct;reteicaPct;reteivaPct;noObligado',
  'Vigilancia Segura Ltda.;PROVEEDOR;900112233;4;facturacion@vigsegura.co;6015550101;Bogotá D.C.;2;0.966;0;NO',
  'Aseo Integral S.A.S.;PROVEEDOR;900445566;1;cobros@aseointegral.co;6015550202;Bogotá D.C.;4;0.966;0;NO',
  'Pedro Ramírez (Mantenimiento);PROVEEDOR;79111222;;pedro.mant@correo.co;3114445566;Bogotá D.C.;6;0.966;0;SI',
].join('\r\n');

export const PLANTILLA_SALDOS_CSV = [
  'cuenta;tercero_documento;unidad;descripcion;debito;credito',
  '111005;;;Saldo inicial cuenta bancaria recaudadora;45000000;0',
  '111010;;;Saldo inicial banco Fondo de Imprevistos Ley 675;12000000;0',
  '130505;52123456;T1-101;Cartera inicial expensas T1-101;850000;0',
  '220505;900112233;;Saldo inicial proveedor Vigilancia;0;4850000',
  '281510;;;Fondo de Imprevistos acumulado Ley 675;0;12000000',
  '311505;;;Patrimonio / Excedentes acumulados iniciales;0;41000000',
].join('\r\n');

export const PLANTILLA_PUC_CSV = [
  'codigo;nombre;tipo;naturaleza;requiereTercero;requiereUnidad;nota',
  '514520;Mantenimiento citofonía y cámaras CCTV;GASTO;D;SI;NO;Subcuenta personalizada',
  '514525;Mantenimiento piscinas y zonas húmedas;GASTO;D;SI;NO;Subcuenta personalizada',
  '417040;Alquiler de salón social;INGRESO;C;SI;SI;Ingreso no operacional PH',
  '111020;Banco cuenta ahorros reserva fachadas;ACTIVO;D;NO;NO;Cuenta bancaria auxiliar',
].join('\r\n');

export function descargarPlantillaCsv(filename: string, content: string): void {
  const bom = '\uFEFF';
  const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function normalizeHeader(h: string): string {
  return h
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function detectDelimiter(headerLine: string): string {
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  const semis = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  if (tabs >= semis && tabs >= commas && tabs > 0) return '\t';
  if (semis >= commas && semis > 0) return ';';
  return ',';
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

export function parseCsvObjects(raw: string): Record<string, string>[] {
  const lines = raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const delim = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delim).map(normalizeHeader);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delim);
    if (cols.every((c) => c === '')) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      if (headers[c]) obj[headers[c]] = (cols[c] ?? '').trim();
    }
    rows.push(obj);
  }
  return rows;
}

export function parseColombianNumber(raw: string | undefined): number {
  if (!raw) return 0;
  let s = raw.replace(/[^0-9.,-]/g, '').trim();
  if (!s) return 0;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    // Decimal comma (e.g. "0,0125" or "1.250.000,50")
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma && lastComma === -1) {
    // Check Colombian thousands-only format like "1.250.000" (multiple dots or 3 digits after dot >= 1000)
    const parts = s.split('.');
    if (parts.length > 2) {
      s = parts.join('');
    }
  } else if (lastDot > lastComma && lastComma !== -1) {
    // US format "1,250,000.50"
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== '') return row[k];
  }
  return '';
}

function normalizeTerceroTipo(raw: string): Tercero['tipo'] {
  const s = raw.trim().toUpperCase();
  if (s.startsWith('PROP')) return 'PROPIETARIO';
  if (s.startsWith('ARR')) return 'ARRENDATARIO';
  if (s.startsWith('EMP')) return 'EMPLEADO';
  return 'PROVEEDOR';
}

function normalizeUnidadTipo(raw: string): 'APARTAMENTO' | 'CASA' | 'LOCAL' {
  const s = raw.trim().toUpperCase();
  if (s.startsWith('CAS')) return 'CASA';
  if (s.startsWith('LOC') || s.startsWith('OFI')) return 'LOCAL';
  return 'APARTAMENTO';
}

export function parseTercerosCsv(raw: string): { rows: TerceroCsvRow[]; errors: string[] } {
  const objs = parseCsvObjects(raw);
  const rows: TerceroCsvRow[] = [];
  const errors: string[] = [];

  objs.forEach((r, idx) => {
    const line = idx + 2;
    const nombre = pick(r, ['nombre', 'razonsocial', 'tercero', 'name']);
    const documento = pick(r, ['documento', 'nit', 'cedula', 'cc', 'identificacion']).replace(/[^0-9A-Za-z-]/g, '');
    if (!nombre || !documento) {
      errors.push(`Fila ${line}: faltan nombre o documento.`);
      return;
    }
    const noOblRaw = pick(r, ['noobligado', 'ds', 'documentosoporte']).toUpperCase();
    rows.push({
      nombre,
      tipo: normalizeTerceroTipo(pick(r, ['tipo', 'rol', 'clase'])),
      documento: documento.split('-')[0],
      dv: pick(r, ['dv', 'digitoverificacion']) || documento.split('-')[1] || undefined,
      email: pick(r, ['email', 'correo', 'correoelectronico']),
      telefono: pick(r, ['telefono', 'celular', 'tel']),
      ciudad: pick(r, ['ciudad', 'municipio']) || 'Bogotá D.C.',
      retefuentePct: parseColombianNumber(pick(r, ['retefuentepct', 'retefuente', 'rf'])),
      reteicaPct: parseColombianNumber(pick(r, ['reteicapct', 'reteica', 'ica'])),
      reteivaPct: parseColombianNumber(pick(r, ['reteivapct', 'reteiva'])),
      noObligado: ['SI', 'SÍ', 'TRUE', '1', 'YES'].includes(noOblRaw),
    });
  });

  if (objs.length === 0) {
    errors.push('No se encontraron filas de datos. Asegúrate de incluir los encabezados en la primera fila.');
  }
  return { rows, errors };
}

export function parseUnidadesCsv(raw: string): { rows: UnidadCsvRow[]; errors: string[] } {
  const objs = parseCsvObjects(raw);
  const rows: UnidadCsvRow[] = [];
  const errors: string[] = [];

  objs.forEach((r, idx) => {
    const line = idx + 2;
    const torre = pick(r, ['torre', 'bloque', 'etapa', 'grupo']) || 'T1';
    const numero = pick(r, ['numero', 'apartamento', 'apto', 'unidad', 'inmueble']);
    const coef = parseColombianNumber(pick(r, ['coeficiente', 'coef', 'porcentaje']));
    if (!numero) {
      errors.push(`Fila ${line}: falta el número de unidad/apartamento.`);
      return;
    }
    if (coef <= 0) {
      errors.push(`Fila ${line} (${torre}-${numero}): el coeficiente debe ser mayor a 0.`);
      return;
    }
    // If user wrote percentage like 1.25 instead of 0.0125, normalize gently only if > 1
    const coeficiente = coef > 1 ? Number((coef / 100).toFixed(6)) : Number(coef.toFixed(6));
    rows.push({
      torre,
      numero,
      tipo: normalizeUnidadTipo(pick(r, ['tipo', 'clase'])),
      area: parseColombianNumber(pick(r, ['area', 'm2', 'metros'])) || 60,
      coeficiente,
      matricula: pick(r, ['matricula', 'matriculainmobiliaria', 'folio']),
      propietarioNombre: pick(r, ['propietarionombre', 'propietario', 'nombrepropietario', 'nombre']),
      propietarioDocumento: pick(r, ['propietariodocumento', 'documentopropietario', 'cedula', 'nit', 'documento']).replace(/[^0-9A-Za-z]/g, ''),
      propietarioEmail: pick(r, ['propietarioemail', 'email', 'correo']),
      propietarioTelefono: pick(r, ['propietariotelefono', 'telefono', 'celular']),
    });
  });

  if (objs.length === 0) {
    errors.push('No se encontraron filas de datos. Asegúrate de incluir los encabezados en la primera fila.');
  }
  return { rows, errors };
}

export function parseSaldosInicialesCsv(raw: string): { rows: SaldoInicialCsvRow[]; errors: string[] } {
  const objs = parseCsvObjects(raw);
  const rows: SaldoInicialCsvRow[] = [];
  const errors: string[] = [];

  objs.forEach((r, idx) => {
    const line = idx + 2;
    const cuenta = pick(r, ['cuenta', 'codigo', 'codigocuenta', 'puc']).replace(/[^0-9]/g, '');
    const debito = Math.round(parseColombianNumber(pick(r, ['debito', 'debe', 'db'])));
    const credito = Math.round(parseColombianNumber(pick(r, ['credito', 'haber', 'cr'])));
    if (!cuenta) {
      errors.push(`Fila ${line}: falta el código de cuenta PUC.`);
      return;
    }
    if (debito <= 0 && credito <= 0) {
      errors.push(`Fila ${line} (cuenta ${cuenta}): ingresa un valor en débito o crédito.`);
      return;
    }
    if (debito > 0 && credito > 0) {
      errors.push(`Fila ${line} (cuenta ${cuenta}): una línea no puede tener débito y crédito al mismo tiempo.`);
      return;
    }
    rows.push({
      cuenta,
      terceroDocumento: pick(r, ['tercerodocumento', 'documento', 'nit', 'cedula', 'tercero']).replace(/[^0-9A-Za-z]/g, ''),
      unidadCodigo: pick(r, ['unidad', 'apto', 'apartamento', 'inmueble']),
      descripcion: pick(r, ['descripcion', 'concepto', 'detalle']) || `Saldo inicial cuenta ${cuenta}`,
      debito,
      credito,
    });
  });

  if (objs.length === 0) {
    errors.push('No se encontraron filas de saldos iniciales.');
  }
  return { rows, errors };
}

function inferirTipoNaturalezaPuc(
  codigo: string,
  tipoRaw: string,
  natRaw: string,
): { tipo: CuentaPuc['tipo']; naturaleza: 'D' | 'C' } {
  const t = tipoRaw.trim().toUpperCase();
  let tipo: CuentaPuc['tipo'];
  if (t.startsWith('ACT')) tipo = 'ACTIVO';
  else if (t.startsWith('PAS')) tipo = 'PASIVO';
  else if (t.startsWith('PAT')) tipo = 'PATRIMONIO';
  else if (t.startsWith('ING')) tipo = 'INGRESO';
  else if (t.startsWith('GAS') || t.startsWith('COS')) tipo = 'GASTO';
  else {
    const first = codigo[0];
    if (first === '1') tipo = 'ACTIVO';
    else if (first === '2') tipo = 'PASIVO';
    else if (first === '3') tipo = 'PATRIMONIO';
    else if (first === '4') tipo = 'INGRESO';
    else tipo = 'GASTO';
  }

  const n = natRaw.trim().toUpperCase();
  let naturaleza: 'D' | 'C';
  if (n === 'D' || n.startsWith('DEB')) naturaleza = 'D';
  else if (n === 'C' || n.startsWith('CRE')) naturaleza = 'C';
  else naturaleza = tipo === 'ACTIVO' || tipo === 'GASTO' ? 'D' : 'C';

  return { tipo, naturaleza };
}

export function parsePucCsv(raw: string): { rows: PucCsvRow[]; errors: string[] } {
  const objs = parseCsvObjects(raw);
  const rows: PucCsvRow[] = [];
  const errors: string[] = [];

  objs.forEach((r, idx) => {
    const line = idx + 2;
    const codigo = pick(r, ['codigo', 'cuenta', 'codigocuenta', 'puc', 'code']).replace(/[^0-9]/g, '');
    const nombre = pick(r, ['nombre', 'nombrecuenta', 'descripcion', 'cuenta', 'name']);
    if (!codigo || codigo.length < 4) {
      errors.push(`Fila ${line}: el código PUC debe tener al menos 4 dígitos.`);
      return;
    }
    if (!nombre || nombre === codigo) {
      errors.push(`Fila ${line} (${codigo}): falta el nombre de la cuenta.`);
      return;
    }
    const { tipo, naturaleza } = inferirTipoNaturalezaPuc(
      codigo,
      pick(r, ['tipo', 'tipocuenta', 'grupo', 'clase']),
      pick(r, ['naturaleza', 'nat']),
    );
    const reqTerRaw = pick(r, ['requieretercero', 'tercero', 'exigetercero']).toUpperCase();
    const reqUniRaw = pick(r, ['requiereunidad', 'unidad', 'exigeunidad']).toUpperCase();
    const nota = pick(r, ['nota', 'observacion', 'detalle']) || undefined;

    rows.push({
      codigo,
      nombre,
      tipo,
      naturaleza,
      requiereTercero: ['SI', 'SÍ', 'TRUE', '1', 'YES'].includes(reqTerRaw),
      requiereUnidad: ['SI', 'SÍ', 'TRUE', '1', 'YES'].includes(reqUniRaw),
      nota,
    });
  });

  if (objs.length === 0) {
    errors.push('No se encontraron cuentas PUC. Incluye al menos las columnas codigo y nombre.');
  }
  return { rows, errors };
}
