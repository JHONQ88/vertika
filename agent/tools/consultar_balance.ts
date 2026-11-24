import { defineTool } from 'eve/tools';
import { z } from 'zod';

export default defineTool({
  description:
    'Obtiene el balance de prueba oficial calculado por el backend de Vértika para una copropiedad y periodo (YYYY-MM o "todos").',
  inputSchema: z.object({
    companyId: z.string().min(1).describe('ID de copropiedad (ej. altavista).'),
    period: z
      .string()
      .optional()
      .describe('Periodo contable YYYY-MM (ej. 2026-11) o "todos". Por defecto "todos".'),
  }),
  label: {
    start: ({ companyId, period }) =>
      `Consultando balance ${companyId} (${period ?? 'todos'})`,
  },
  async execute({ companyId, period }, ctx) {
    const { vertikaFetch } = await import('../lib/vertika-api.ts');
    const per = period?.trim() || 'todos';
    return vertikaFetch<Record<string, unknown>>(
      `/api/v1/companies/${encodeURIComponent(companyId.trim())}/reports/balance?period=${encodeURIComponent(per)}`,
      { signal: ctx.abortSignal, sessionAuth: ctx.session.auth },
    );
  },
});
