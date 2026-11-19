/**
 * Prueba de humo del dominio contable.
 * Se ejecuta con esbuild + node (ver script en package.json).
 */
import { buildSeed } from '../src/domain/seed';
import { CUENTA_MAP } from '../src/domain/puc';
import {
  acarrearPreAsiento,
  balancePrueba,
  cartera,
  ejecucionPresupuestal,
  filasLibro,
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

console.log(
  fallos === 0
    ? '\n✔ Prueba de humo OK: el motor contable es consistente.\n'
    : `\n✘ ${fallos} verificaciones fallaron.\n`,
);
process.exit(fallos === 0 ? 0 : 1);
