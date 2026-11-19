export type Naturaleza = 'D' | 'C';

export type TipoCuenta = 'ACTIVO' | 'PASIVO' | 'PATRIMONIO' | 'INGRESO' | 'GASTO';

export type TipoComprobante = 'CC' | 'RC' | 'CE' | 'NC' | 'DS';

export type Origen =
  | 'AGENTE_IA_DIAN'
  | 'AGENTE_IA_OCR'
  | 'AGENTE_IA_LIQUIDADOR'
  | 'WEBHOOK_NFC'
  | 'WEBHOOK_BRE_B'
  | 'TESORERIA_PAYOUT'
  | 'CIERRE_AUTOMATICO'
  | 'CONTADOR_MANUAL';

export interface CuentaPuc {
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  naturaleza: Naturaleza;
  requiereTercero?: boolean;
  requiereUnidad?: boolean;
  esEfectivo?: boolean;
  restringida?: boolean;
  rubroKey?: string;
  nota?: string;
}

export interface Copropiedad {
  id: string;
  nit: string;
  razonSocial: string;
  nombreCorto: string;
  sigla: string;
  ciudad: string;
  direccion: string;
  grupoNiif: 2 | 3;
  fondoImprevistosPct: number;
  tasaMoraMensual: number;
  diaCorteProntoPago: number;
  descuentoProntoPagoPct: number;
  llaveBreB: string;
  presupuestoAnual: number;
  periodoActual: string;
  saldosIniciales: Record<string, number>;
  escala: number;
  color: string;
}

export interface Unidad {
  id: string;
  empresaId: string;
  torre: string;
  numero: string;
  tipo: 'APARTAMENTO' | 'CASA' | 'LOCAL';
  area: number;
  coeficiente: number;
  matricula: string;
  propietarioId: string;
  arrendatarioId?: string;
  carteraCongelada: boolean;
}

export type RolTercero = 'PROPIETARIO' | 'ARRENDATARIO' | 'PROVEEDOR' | 'EMPLEADO';

export interface Tercero {
  id: string;
  empresaId?: string;
  nombre: string;
  tipo: RolTercero;
  documento: string;
  dv?: string;
  email: string;
  telefono: string;
  ciudad: string;
  retefuentePct: number;
  reteicaPct: number;
  reteivaPct: number;
  noObligado: boolean;
  regimenEspecial?: boolean;
}

export interface Rubro {
  id: string;
  empresaId: string;
  key: string;
  nombre: string;
  centro: string;
  presupuestoAnual: number;
  cuenta: string;
}

export interface Linea {
  id: string;
  cuenta: string;
  descripcion: string;
  debito: number;
  credito: number;
  terceroId?: string;
  unidadId?: string;
  rubroId?: string;
}

export interface Comprobante {
  id: string;
  empresaId: string;
  periodo: string;
  tipo: TipoComprobante;
  consecutivo: number;
  fecha: string;
  estado: 'ASENTADO' | 'ANULADO';
  origen: Origen;
  descripcion: string;
  lineas: Linea[];
  totalDebito: number;
  totalCredito: number;
  referencia?: string;
  hash: string;
  creadoPor: string;
  createdAt: string;
}

export interface DocItem {
  descripcion: string;
  cantidad: number;
  valorUnitario: number;
}

export interface Retencion {
  nombre: string;
  base: number;
  tarifa: number;
  valor: number;
  cuenta: string;
}

export interface Documento {
  clase: 'FACTURA' | 'RECIBO' | 'SOPORTE';
  numero: string;
  emisor: string;
  nit: string;
  fecha: string;
  cufe?: string;
  items: DocItem[];
  subtotal: number;
  iva: number;
  total: number;
  retenciones: Retencion[];
  metodo?: string;
  referencia?: string;
  unidadLabel?: string;
  pagador?: string;
  xml?: string;
}

export interface PreAsiento {
  id: string;
  empresaId: string;
  periodo: string;
  tipo: TipoComprobante;
  fecha: string;
  agente: string;
  confianza: number;
  terceroId: string;
  unidadId?: string;
  rubroId?: string;
  descripcion: string;
  documento: Documento;
  lineas: Linea[];
  estado: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';
  notas: string[];
}

export interface AsientoValidacion {
  ok: boolean;
  totalDebito: number;
  totalCredito: number;
  diferencia: number;
  errores: string[];
}

export interface EstadoApp {
  version: number;
  activeCompanyId: string;
  periodo: string;
  preAsientos: PreAsiento[];
  comprobantes: Comprobante[];
  periodosCerrados: Record<string, string[]>;
  auditoria: EventoAuditoria[];
}

export interface EventoAuditoria {
  id: string;
  ts: string;
  actor: string;
  accion: string;
  detalle: string;
  empresaId: string;
}
