/**
 * Prueba de humo del dominio contable.
 * Se ejecuta con esbuild + node (ver script en package.json).
 */
import { buildSeed } from '../src/domain/seed';
import type { Comprobante, PreAsiento } from '../src/domain/types';
import { CUENTA_MAP } from '../src/domain/puc';
import {
  acarrearPreAsiento,
  balancePrueba,
  cartera,
  ejecucionPresupuestal,
  filasLibro,
  lineasCierre,
  previewCierre,
  resumenPeriodo,
  validarAsiento,
} from '../src/domain/engine';

const datos = buildSeed();
let fallos = 0;

function check(nombre: string, ok: boolean, detalle = '') {
  if (ok) {
    console.log(`  ok   ${nombre}`);
  } else {
    fallos += 1;
    console.error(`  FALLA ${nombre}${detalle ? ` · ${detalle}` : ''}`);
  }
}

console.log('\n1. Coeficientes de copropiedad');
for (const empresa of datos.companies) {
  const unidades = datos.units.filter((u) => u.empresaId === empresa.id);
  const suma = unidades.reduce((s, u) => s + u.coeficiente, 0);
  check(
    `${empresa.nombreCorto}: ${unidades.length} unidades suman 100%`,
    Math.abs(suma - 100) < 1e-6,
    `suma=${suma}`,
  );
}

console.log('\n2. Partida doble en todos los comprobantes');
let lineasTotales = 0;
for (const c of datos.comprobantes) {
  lineasTotales += c.lineas.length;
  const v = validarAsiento(c.lineas);
  check(`${c.id}`, v.ok, v.errores.join(' | '));
  const cuentasOk = c.lineas.every((l) => !!CUENTA_MAP[l.cuenta]);
  check(`${c.id} usa solo cuentas del PUC`, cuentasOk);
  if (c.totalDebito !== c.totalCredito) check(`${c.id} totales cuadran`, false);
}
console.log(`  → ${datos.comprobantes.length} comprobantes / ${lineasTotales} líneas`);

console.log('\n3. Balance de prueba por empresa y periodo');
for (const empresa of datos.companies) {
  for (const periodo of ['2026-09', '2026-10', '2026-11']) {
    const b = balancePrueba(datos.comprobantes, empresa, periodo);
    check(
      `${empresa.nombreCorto} ${periodo} cuadra`,
      b.cuadra && Math.abs(b.totalDebitos - b.totalCreditos) < 1,
      `saldos=${b.totalSaldoActual.toFixed(2)} débitos=${b.totalDebitos} créditos=${b.totalCreditos}`,
    );
  }
}

console.log('\n4. Cartera, presupuesto y cierre');
for (const empresa of datos.companies) {
  const unidades = datos.units.filter((u) => u.empresaId === empresa.id);
  const rubros = datos.rubros.filter((r) => r.empresaId === empresa.id);
  const c = cartera(datos.comprobantes, empresa, unidades, datos.terceros, empresa.periodoActual);
  check(`${empresa.nombreCorto}: cartera devuelve todas las unidades`, c.length === unidades.length);
  check(
    `${empresa.nombreCorto}: cartera sin valores inválidos`,
    c.every((f) => Number.isFinite(f.saldo) && Number.isFinite(f.cargado) && Number.isFinite(f.pagado)),
  );
  const e = ejecucionPresupuestal(datos.comprobantes, empresa, rubros, empresa.periodoActual);
  check(`${empresa.nombreCorto}: ejecución devuelve rubros`, e.length > 0);
  check(
    `${empresa.nombreCorto}: ejecución sin NaN`,
    e.every((f) => Number.isFinite(f.ejecutado) && Number.isFinite(f.pct)),
  );
  const p = previewCierre(datos.comprobantes, empresa, unidades, datos.terceros, empresa.periodoActual);
  check(
    `${empresa.nombreCorto}: preview de cierre coherente`,
    p.depreciacion >= 0 && p.provision >= 0 && p.trasladoFondo >= 0 && p.carteraTotal >= 0,
  );
  const r = resumenPeriodo(datos.comprobantes, empresa, unidades, datos.terceros, empresa.periodoActual);
  check(
    `${empresa.nombreCorto}: resumen del periodo`,
    r.facturado > 0 && r.gastos > 0 && r.unidadesAlDia + r.unidadesEnMora === unidades.length,
  );
  const libro = filasLibro(datos.comprobantes, empresa.id, empresa.periodoActual);
  check(`${empresa.nombreCorto}: libro auxiliar con movimientos`, libro.length > 0);
}

console.log('\n5. Acarreo IA de retenciones');
const preConRetenciones = datos.preAsientos.find((p) => {
  const t = datos.terceros.find((x) => x.id === p.terceroId);
  return !!t && (t.retefuentePct > 0 || t.reteicaPct > 0 || t.reteivaPct > 0);
});
check('hay un pre-asiento con retenciones para probar', !!preConRetenciones);
if (preConRetenciones) {
  const ac = acarrearPreAsiento(preConRetenciones, datos.terceros);
  check('el acarreo devuelve líneas', !!ac && ac.lineas.length >= 2);
  if (ac) {
    const v = validarAsiento(ac.lineas);
    check('el asiento acarreado cuadra', v.ok, v.errores.join(' | '));
  }
}

console.log('\n6. Periodos y pre-asientos');
const cerrados = datos.companies.map((e) => [e.id, e.periodoActual]);
check('los periodos actuales son 2026-11', cerrados.every(([, p]) => p === '2026-11'));
check('hay pre-asientos pendientes', datos.preAsientos.length > 0);
check(
  'los pre-asientos están en el periodo abierto',
  datos.preAsientos.every((p) => p.periodo === '2026-11'),
);

console.log('\n7. Casos borde del motor contable');
check(
  'rechaza menos de 2 líneas',
  !validarAsiento([{ id: 'e1', cuenta: '513505', descripcion: 'Una', debito: 100, credito: 0 }]).ok,
);
check(
  'rechaza débito/crédito negativo',
  !validarAsiento([
    { id: 'e1', cuenta: '513505', descripcion: 'Neg', debito: -100, credito: 0 },
    { id: 'e2', cuenta: '220505', descripcion: 'Neg', debito: 0, credito: -100 },
  ]).ok,
);
check(
  'rechaza débito y crédito simultáneos',
  !validarAsiento([
    { id: 'e1', cuenta: '513505', descripcion: 'Ambos', debito: 100, credito: 100 },
    { id: 'e2', cuenta: '220505', descripcion: 'CxP', debito: 0, credito: 0 },
  ]).ok,
);
check(
  'rechaza línea en cero y cuenta desconocida',
  !validarAsiento([
    { id: 'e1', cuenta: '999999', descripcion: 'Desconocida', debito: 100, credito: 0 },
    { id: 'e2', cuenta: '220505', descripcion: 'Cero', debito: 0, credito: 0 },
  ]).ok,
);
check(
  'rechaza asiento descuadrado',
  !validarAsiento([
    { id: 'e1', cuenta: '513505', descripcion: 'Gasto', debito: 1000, credito: 0 },
    { id: 'e2', cuenta: '220505', descripcion: 'CxP', debito: 0, credito: 900 },
  ]).ok,
);

{
  const preNoRedondo: PreAsiento = {
    id: 'pre-no-100',
    empresaId: 'altavista',
    periodo: '2026-11',
    tipo: 'CC',
    fecha: '2026-11-15',
    agente: 'AGENTE_IA_DIAN',
    confianza: 98,
    terceroId: 'prov-atlas',
    descripcion: 'Factura con centavos',
    documento: {
      clase: 'FACTURA',
      numero: 'FE-999',
      emisor: 'Seguridad Atlas S.A.S.',
      nit: '900.412.887-3',
      fecha: '2026-11-15',
      items: [{ descripcion: 'Servicio', cantidad: 1, valorUnitario: 1_250_350 }],
      subtotal: 1_250_350,
      iva: 237_566.5,
      total: 1_487_916.5,
      retenciones: [],
    },
    lineas: [
      { id: 'l1', cuenta: '513505', descripcion: 'Vigilancia', debito: 1_250_350, credito: 0 },
      { id: 'l2', cuenta: '135515', descripcion: 'IVA', debito: 237_566.5, credito: 0 },
      { id: 'l3', cuenta: '220505', descripcion: 'CxP', debito: 0, credito: 1_487_916.5 },
    ],
    estado: 'PENDIENTE',
    notas: [],
  };
  const ac = acarrearPreAsiento(preNoRedondo, datos.terceros);
  check(
    'acarreo cuadra en facturas no múltiplos de 100',
    !!ac && validarAsiento(ac.lineas).ok,
    ac ? validarAsiento(ac.lineas).errores.join(' | ') : 'sin acarreo',
  );
}

{
  const emp0 = datos.companies[0];
  const unis0 = datos.units.filter((u) => u.empresaId === emp0.id);
  const rubros0 = datos.rubros.filter((r) => r.empresaId === emp0.id);
  const baseLibro = filasLibro(datos.comprobantes, emp0.id, '2026-11').length;
  const baseBal = balancePrueba(datos.comprobantes, emp0, '2026-11');
  const basePres = ejecucionPresupuestal(datos.comprobantes, emp0, rubros0, '2026-11');
  const baseCart = cartera(datos.comprobantes, emp0, unis0, datos.terceros, '2026-11');
  const baseRes = resumenPeriodo(datos.comprobantes, emp0, unis0, datos.terceros, '2026-11');

  const anulado: Comprobante = {
    id: 'comp-anulado-test',
    empresaId: emp0.id,
    periodo: '2026-11',
    tipo: 'CC',
    consecutivo: 9999,
    fecha: '2026-11-16',
    estado: 'ANULADO',
    origen: 'CONTADOR_MANUAL',
    descripcion: 'Comprobante anulado de prueba',
    lineas: [
      { id: 'an1', cuenta: '513505', descripcion: 'Gasto anulado', debito: 5_000_000, credito: 0 },
      { id: 'an2', cuenta: '130505', descripcion: 'Cartera anulada', debito: 5_000_000, credito: 0, unidadId: unis0[0].id },
      { id: 'an3', cuenta: '220505', descripcion: 'CxP anulada', debito: 0, credito: 10_000_000 },
    ],
    totalDebito: 10_000_000,
    totalCredito: 10_000_000,
    hash: '00000000',
    creadoPor: 'Test',
    createdAt: '2026-11-16T00:00:00.000Z',
  };
  const conAnulado = [...datos.comprobantes, anulado];
  check(
    'comprobantes ANULADO no alteran libro, balance, presupuesto, cartera ni resumen',
    filasLibro(conAnulado, emp0.id, '2026-11').length === baseLibro &&
      balancePrueba(conAnulado, emp0, '2026-11').totalDebitos === baseBal.totalDebitos &&
      ejecucionPresupuestal(conAnulado, emp0, rubros0, '2026-11')[0].ejecutado === basePres[0].ejecutado &&
      cartera(conAnulado, emp0, unis0, datos.terceros, '2026-11')[0].saldo === baseCart[0].saldo &&
      resumenPeriodo(conAnulado, emp0, unis0, datos.terceros, '2026-11').gastos === baseRes.gastos,
  );

  const cierreSinFondo = lineasCierre(
    emp0,
    '2026-11',
    { depreciacion: 1_000_000, provision: 200_000, trasladoFondo: 0, carteraTotal: 4_000_000 },
    rubros0,
  );
  check(
    'lineasCierre omite líneas en 0 y cuadra',
    cierreSinFondo.length === 4 &&
      cierreSinFondo.every((l) => l.debito > 0 || l.credito > 0) &&
      validarAsiento(cierreSinFondo).ok,
  );

  const u0 = unis0[0];
  const compMora: Comprobante[] = [
    {
      id: 'm1',
      empresaId: emp0.id,
      periodo: '2026-09',
      tipo: 'CC',
      consecutivo: 1,
      fecha: '2026-09-01',
      estado: 'ASENTADO',
      origen: 'CONTADOR_MANUAL',
      descripcion: 'Cobro sep',
      lineas: [
        { id: 'm1a', cuenta: '130505', descripcion: 'Cuota', debito: 300_000, credito: 0, unidadId: u0.id },
        { id: 'm1b', cuenta: '417005', descripcion: 'Ingreso', debito: 0, credito: 300_000 },
      ],
      totalDebito: 300_000,
      totalCredito: 300_000,
      hash: '11111111',
      creadoPor: 'Test',
      createdAt: '2026-09-01T00:00:00.000Z',
    },
    {
      id: 'm2',
      empresaId: emp0.id,
      periodo: '2026-10',
      tipo: 'RC',
      consecutivo: 1,
      fecha: '2026-10-05',
      estado: 'ASENTADO',
      origen: 'CONTADOR_MANUAL',
      descripcion: 'Pago total oct',
      lineas: [
        { id: 'm2a', cuenta: '111005', descripcion: 'Banco', debito: 300_000, credito: 0 },
        { id: 'm2b', cuenta: '130505', descripcion: 'Abono', debito: 0, credito: 300_000, unidadId: u0.id },
      ],
      totalDebito: 300_000,
      totalCredito: 300_000,
      hash: '22222222',
      creadoPor: 'Test',
      createdAt: '2026-10-05T00:00:00.000Z',
    },
  ];
  const cartSaldada = cartera(compMora, emp0, [u0], datos.terceros, '2026-11')[0];
  check(
    'cartera saldada deja unidad AL_DIA y sin periodoMasAntiguo',
    cartSaldada.estado === 'AL_DIA' &&
      cartSaldada.saldo === 0 &&
      cartSaldada.periodoMasAntiguo === null &&
      cartSaldada.diasVencido === 0,
  );
}

console.log(
  fallos === 0
    ? '\n✔ Prueba de humo OK: el motor contable es consistente.\n'
    : `\n✘ ${fallos} verificaciones fallaron.\n`,
);
process.exit(fallos === 0 ? 0 : 1);
