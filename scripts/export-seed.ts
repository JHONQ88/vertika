import { buildSeed, PERIODOS_CERRADOS } from '../src/domain/seed';

const datos = buildSeed();
const estado = {
  version: 4,
  activeCompanyId: datos.companies[0].id,
  periodo: datos.companies[0].periodoActual,
  preAsientos: datos.preAsientos,
  comprobantes: datos.comprobantes,
  periodosCerrados: PERIODOS_CERRADOS,
  auditoria: [
    {
      id: 'aud-0',
      ts: '2026-10-31T18:00:00.000Z',
      actor: 'Sistema',
      accion: 'Cierre contable',
      detalle: 'Periodo 2026-10 cerrado con depreciación, provisión y traslado de fondo.',
      empresaId: datos.companies[0].id,
    },
  ],
};

console.log(JSON.stringify({ datos, estado }, null, 2));
