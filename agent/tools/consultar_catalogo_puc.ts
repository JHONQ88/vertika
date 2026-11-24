import { defineTool } from 'eve/tools';
import { z } from 'zod';

interface LedgerAccountDto {
  code: string;
  name: string;
  account_type: string;
  nature: string;
  rubric_key?: string | null;
  requires_third_party: boolean;
  requires_unit: boolean;
  is_cash: boolean;
  restricted: boolean;
  note?: string | null;
}

export default defineTool({
  description:
    'Consulta las cuentas del catálogo PUC ESAL de Vértika con filtros opcionales por copropiedad, tipo de cuenta y palabra clave o código.',
  inputSchema: z.object({
    companyId: z
      .string()
      .optional()
      .describe('ID o slug de copropiedad (ej. altavista).'),
    tipo: z
      .enum(['ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'GASTO'])
      .optional()
      .describe('Filtra por grupo contable.'),
    busqueda: z
      .string()
      .optional()
      .describe('Texto libre para filtrar por código o nombre (ej. "vigilancia", "2365").'),
  }),
  label: {
    start: ({ busqueda, tipo }) =>
      `Consultando PUC ESAL${tipo ? ` (${tipo})` : ''}${busqueda ? `: ${busqueda}` : ''}`,
  },
  async execute({ companyId, tipo, busqueda }, ctx) {
    const { vertikaFetch } = await import('../lib/vertika-api.ts');
    const qs = companyId?.trim()
      ? `?company_id=${encodeURIComponent(companyId.trim())}`
      : '';
    const accounts = await vertikaFetch<LedgerAccountDto[]>(`/api/v1/puc${qs}`, {
      signal: ctx.abortSignal,
      sessionAuth: ctx.session.auth,
    });

    const needle = busqueda?.trim().toLowerCase() ?? '';
    const filtradas = accounts
      .filter((a) => !tipo || a.account_type === tipo)
      .filter(
        (a) =>
          !needle ||
          a.code.toLowerCase().includes(needle) ||
          a.name.toLowerCase().includes(needle) ||
          (a.note ?? '').toLowerCase().includes(needle),
      );

    const cap = 40;
    return {
      total: filtradas.length,
      mostradas: Math.min(filtradas.length, cap),
      cuentas: filtradas.slice(0, cap).map((a) => ({
        code: a.code,
        name: a.name,
        tipo: a.account_type,
        nat: a.nature,
        reqTercero: a.requires_third_party,
        reqUnidad: a.requires_unit,
      })),
    };
  },
});
