/**
 * Render de humo: monta cada vista con ReactDOMServer para detectar
 * referencias rotas o errores en tiempo de render.
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { VistaProps, ViewKey } from '../src/ui-types';
import { acciones, empresaActiva, esPeriodoBloqueado, getEstado, DATOS } from '../src/store';
import { fmtPeriodo } from '../src/domain/format';
import { Bandeja } from '../src/views/Bandeja';
import { Libro } from '../src/views/Libro';
import { Balance } from '../src/views/Balance';
import { Presupuesto } from '../src/views/Presupuesto';
import { Cartera } from '../src/views/Cartera';
import { Comprobantes } from '../src/views/Comprobantes';
import { Maestros } from '../src/views/Maestros';
import { Cierre } from '../src/views/Cierre';
import { Ajustes } from '../src/views/Ajustes';
import App from '../src/App';

const memoria = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => memoria.get(k) ?? null,
  setItem: (k: string, v: string) => void memoria.set(k, v),
  removeItem: (k: string) => void memoria.delete(k),
  clear: () => memoria.clear(),
  key: (i: number) => Array.from(memoria.keys())[i] ?? null,
  get length() {
    return memoria.size;
  },
} as Storage;

const estado = getEstado();
const empresa = empresaActiva(estado);
const base: VistaProps = {
  empresa,
  estado,
  filtros: {},
  setFiltros: () => {},
  setView: () => {},
  toast: () => {},
  modo: 0,
  setModo: () => {},
};

let fallos = 0;
function probar(nombre: string, el: React.ReactElement) {
  try {
    const html = renderToString(el);
    if (html.length < 50) throw new Error(`HTML sospechosamente corto (${html.length})`);
    console.log(`  ok   ${nombre} (${html.length} bytes)`);
  } catch (e) {
    fallos += 1;
    console.error(`  FALLA ${nombre}: ${(e as Error).message}`);
  }
}

console.log('\nRender de vistas');
probar('Bandeja', createElement(Bandeja, { ...base, seleccionado: null, setSeleccionado: () => {}, onAprobar: () => {}, onRechazar: () => {}, onAcarrear: () => {} }));
probar('Libro', createElement(Libro, base));
probar('Balance', createElement(Balance, base));
probar('Presupuesto', createElement(Presupuesto, base));
probar('Cartera', createElement(Cartera, base));
probar('Comprobantes', createElement(Comprobantes, base));
probar('Maestros', createElement(Maestros, base));
probar('Cierre', createElement(Cierre, base));
probar('Ajustes', createElement(Ajustes, base));
probar('App completa', createElement(App));

console.log('\nVerificaciones de estado');
const bloques: Array<[string, boolean]> = [
  ['periodo activo abierto', !esPeriodoBloqueado(estado, estado.periodo)],
  ['empresa activa definida', !!empresa && !!empresa.nombreCorto],
  ['datos maestros cargados', DATOS.companies.length === 3 && DATOS.units.length > 0],
  ['acciones disponibles', typeof acciones.aprobarPreAsiento === 'function'],
  ['formato de periodo', fmtPeriodo('2026-11').includes('2026')],
];
for (const [nombre, ok] of bloques) {
  if (ok) console.log(`  ok   ${nombre}`);
  else {
    fallos += 1;
    console.error(`  FALLA ${nombre}`);
  }
}

console.log(fallos === 0 ? '\n✔ Render OK en todas las vistas.\n' : `\n✘ ${fallos} fallos de render.\n`);
process.exit(fallos === 0 ? 0 : 1);
