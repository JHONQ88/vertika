import type { CuentaPuc } from './types';

/**
 * Catálogo PUC ESAL para propiedad horizontal.
 * Estructura de referencia: Decreto 2420 de 2015, Orientación Técnica No. 15 del CTCP
 * y práctica contable de copropiedades bajo la Ley 675 de 2001 (NIIF Grupo 2 y 3).
 * Los códigos son parametrizables por copropiedad en producción.
 */
export const CUENTAS: CuentaPuc[] = [
  // ── ACTIVO ────────────────────────────────────────────────────────────────
  { codigo: '110505', nombre: 'Caja general', tipo: 'ACTIVO', naturaleza: 'D', esEfectivo: true },
  { codigo: '111005', nombre: 'Bancos - cuenta recaudadora', tipo: 'ACTIVO', naturaleza: 'D', esEfectivo: true, nota: 'Cuenta maestra de recaudo de expensas.' },
  { codigo: '111010', nombre: 'Bancos - Fondo de imprevistos', tipo: 'ACTIVO', naturaleza: 'D', esEfectivo: true, restringida: true, nota: 'Efectivo restringido. Ley 675 art. 36.' },
  { codigo: '130505', nombre: 'CxC expensas ordinarias', tipo: 'ACTIVO', naturaleza: 'D', requiereTercero: true, requiereUnidad: true },
  { codigo: '130510', nombre: 'CxC expensas extraordinarias', tipo: 'ACTIVO', naturaleza: 'D', requiereTercero: true, requiereUnidad: true },
  { codigo: '130515', nombre: 'CxC intereses de mora', tipo: 'ACTIVO', naturaleza: 'D', requiereTercero: true, requiereUnidad: true },
  { codigo: '130520', nombre: 'CxC multas y sanciones', tipo: 'ACTIVO', naturaleza: 'D', requiereTercero: true, requiereUnidad: true },
  { codigo: '135515', nombre: 'IVA descontable', tipo: 'ACTIVO', naturaleza: 'D' },
  { codigo: '139905', nombre: 'Deterioro de cartera', tipo: 'ACTIVO', naturaleza: 'C', nota: 'Cuenta contra-activo.' },
  { codigo: '152405', nombre: 'Construcciones y edificaciones', tipo: 'ACTIVO', naturaleza: 'D' },
  { codigo: '152805', nombre: 'Equipo de cómputo y comunicaciones', tipo: 'ACTIVO', naturaleza: 'D' },
  { codigo: '159215', nombre: 'Depreciación acumulada', tipo: 'ACTIVO', naturaleza: 'C', nota: 'Cuenta contra-activo.' },

  // ── PASIVO ────────────────────────────────────────────────────────────────
  { codigo: '220505', nombre: 'Proveedores nacionales', tipo: 'PASIVO', naturaleza: 'C', requiereTercero: true },
  { codigo: '236540', nombre: 'Retención en la fuente', tipo: 'PASIVO', naturaleza: 'C' },
  { codigo: '236705', nombre: 'Retención de IVA', tipo: 'PASIVO', naturaleza: 'C' },
  { codigo: '236801', nombre: 'Retención de ICA', tipo: 'PASIVO', naturaleza: 'C' },
  { codigo: '250505', nombre: 'Salarios y prestaciones por pagar', tipo: 'PASIVO', naturaleza: 'C', requiereTercero: true },
  { codigo: '280505', nombre: 'Anticipos de copropietarios', tipo: 'PASIVO', naturaleza: 'C', requiereTercero: true, requiereUnidad: true },
  { codigo: '281510', nombre: 'Fondo de imprevistos - Ley 675', tipo: 'PASIVO', naturaleza: 'C', nota: 'Mínimo 1% de las expensas comunes.' },

  // ── PATRIMONIO ────────────────────────────────────────────────────────────
  { codigo: '310505', nombre: 'Fondo social', tipo: 'PATRIMONIO', naturaleza: 'C' },
  { codigo: '330505', nombre: 'Reservas estatutarias', tipo: 'PATRIMONIO', naturaleza: 'C' },
  { codigo: '360505', nombre: 'Excedente del ejercicio', tipo: 'PATRIMONIO', naturaleza: 'C' },
  { codigo: '370505', nombre: 'Excedentes de ejercicios anteriores', tipo: 'PATRIMONIO', naturaleza: 'C' },

  // ── INGRESOS ──────────────────────────────────────────────────────────────
  { codigo: '417005', nombre: 'Cuotas de administración ordinarias', tipo: 'INGRESO', naturaleza: 'C', requiereUnidad: true },
  { codigo: '417010', nombre: 'Cuotas extraordinarias', tipo: 'INGRESO', naturaleza: 'C', requiereUnidad: true },
  { codigo: '417015', nombre: 'Multas y sanciones', tipo: 'INGRESO', naturaleza: 'C', requiereUnidad: true },
  { codigo: '417020', nombre: 'Reservas de zonas comunes', tipo: 'INGRESO', naturaleza: 'C', requiereUnidad: true },
  { codigo: '417025', nombre: 'Parqueaderos y depósitos', tipo: 'INGRESO', naturaleza: 'C', requiereUnidad: true },
  { codigo: '417030', nombre: 'Intereses de mora', tipo: 'INGRESO', naturaleza: 'C', requiereUnidad: true },
  { codigo: '417035', nombre: 'Descuento por pronto pago', tipo: 'INGRESO', naturaleza: 'D', nota: 'Cuenta contra-ingreso.' },
  { codigo: '417040', nombre: 'Recuperación de deterioro de cartera', tipo: 'INGRESO', naturaleza: 'C' },

  // ── GASTOS ────────────────────────────────────────────────────────────────
  { codigo: '510506', nombre: 'Sueldos y salarios', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'ADM' },
  { codigo: '510530', nombre: 'Cesantías', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'ADM' },
  { codigo: '510536', nombre: 'Intereses sobre cesantías', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'ADM' },
  { codigo: '510539', nombre: 'Prima de servicios', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'ADM' },
  { codigo: '510542', nombre: 'Vacaciones', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'ADM' },
  { codigo: '510548', nombre: 'Aportes a seguridad social', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'ADM' },
  { codigo: '510551', nombre: 'Aportes parafiscales', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'ADM' },
  { codigo: '511005', nombre: 'Honorarios', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'HON' },
  { codigo: '512010', nombre: 'Arrendamientos', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'ADM' },
  { codigo: '513010', nombre: 'Seguros', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'SEG' },
  { codigo: '513505', nombre: 'Vigilancia y seguridad', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'VIG' },
  { codigo: '513510', nombre: 'Aseo y cafetería', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'ASE' },
  { codigo: '513525', nombre: 'Energía eléctrica', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'SPU' },
  { codigo: '513530', nombre: 'Acueducto y alcantarillado', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'SPU' },
  { codigo: '513535', nombre: 'Gas natural', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'SPU' },
  { codigo: '513540', nombre: 'Internet y telecomunicaciones', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'SPU' },
  { codigo: '514505', nombre: 'Mantenimiento de ascensores', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'ASC' },
  { codigo: '514510', nombre: 'Mantenimiento de zonas comunes', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'MAN' },
  { codigo: '514515', nombre: 'Jardinería', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'MAN' },
  { codigo: '516005', nombre: 'Depreciación de PP&E', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'MAN' },
  { codigo: '519505', nombre: 'Gastos bancarios', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'FIN' },
  { codigo: '519510', nombre: 'Gastos legales y notariales', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'ASM' },
  { codigo: '519520', nombre: 'Gastos de asamblea', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'ASM' },
  { codigo: '519530', nombre: 'Elementos de aseo y cafetería', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'ASE' },
  { codigo: '519905', nombre: 'Deterioro de cartera', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'FIN' },
  { codigo: '530520', nombre: 'Intereses financieros', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'FIN' },
  { codigo: '540505', nombre: 'Impuesto de industria y comercio', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'FIN' },
  { codigo: '540525', nombre: 'Gravamen a los movimientos financieros', tipo: 'GASTO', naturaleza: 'D', rubroKey: 'FIN' },
];

export const CUENTA_MAP: Record<string, CuentaPuc> = Object.fromEntries(
  CUENTAS.map((c) => [c.codigo, c]),
);

export interface RubroTemplate {
  key: string;
  nombre: string;
  centro: string;
  cuenta: string;
  baseAnual: number;
}

/** Presupuesto anual de referencia (copropiedad tipo, 24 unidades). */
export const RUBRO_TEMPLATE: RubroTemplate[] = [
  { key: 'ADM', nombre: 'Administración y nómina', centro: 'Administración', cuenta: '510506', baseAnual: 150_000_000 },
  { key: 'VIG', nombre: 'Vigilancia y seguridad', centro: 'Portería y seguridad', cuenta: '513505', baseAnual: 222_000_000 },
  { key: 'ASE', nombre: 'Aseo y cafetería', centro: 'Zonas comunes', cuenta: '513510', baseAnual: 58_000_000 },
  { key: 'SPU', nombre: 'Servicios públicos', centro: 'Zonas comunes', cuenta: '513525', baseAnual: 60_000_000 },
  { key: 'MAN', nombre: 'Mantenimiento general', centro: 'Infraestructura', cuenta: '514510', baseAnual: 42_000_000 },
  { key: 'ASC', nombre: 'Ascensores', centro: 'Infraestructura', cuenta: '514505', baseAnual: 30_000_000 },
  { key: 'ZON', nombre: 'Zonas comunes y comunicación', centro: 'Zonas comunes', cuenta: '519530', baseAnual: 14_000_000 },
  { key: 'SEG', nombre: 'Seguros', centro: 'Administración', cuenta: '513010', baseAnual: 12_000_000 },
  { key: 'HON', nombre: 'Honorarios contables y revisoría', centro: 'Administración', cuenta: '511005', baseAnual: 44_000_000 },
  { key: 'ASM', nombre: 'Asamblea y gastos legales', centro: 'Administración', cuenta: '519510', baseAnual: 8_000_000 },
  { key: 'FIN', nombre: 'Gastos financieros', centro: 'Tesorería', cuenta: '519505', baseAnual: 6_000_000 },
  { key: 'IMP', nombre: 'Imprevistos', centro: 'Administración', cuenta: '519905', baseAnual: 4_000_000 },
];

export const TIPOS_CUENTA = ['ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'GASTO'] as const;
