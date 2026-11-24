import { defineTool } from 'eve/tools';
import { z } from 'zod';

interface EntryDto {
  id: string;
  periodo: string;
  tipo: string;
  consecutivo: number;
  fecha: string;
  estado: string;
  origen: string;
  descripcion: string;
  totalDebito: number;
  totalCredito: number;
  referencia?: string;
}

export default defineTool({
  description:
    'Lista los comprobantes contables de una copropiedad con filtros opcionales por periodo (YYYY-MM) y tipo de documento (CC, RC, CE, NC, DS).',
  inputSchema: z.object({
    companyId: z.string().min(1).describe('ID de copropiedad (ej. altavista).'),
    period: z
      .string()
      .optional()
      .describe('Periodo YYYY-MM (ej. 2026-11). Omitir para listar todos los periodos.'),
    tipo: z
      .enum(['CC', 'RC', 'CE', 'NC', 'DS'])
      .optional()
      .describe('Tipo de comprobante opcional.'),
    limite: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Máximo de comprobantes a devolver (por defecto 20).'),
  }),
  label: {
    start: ({ companyId, period }) =>
      `Consultando comprobantes de ${companyId}${period ? ` (${period})` : ''}`,
  },
  async execute({ companyId, period, tipo, limite }, ctx) {
    const { vertikaFetch } = await import('../lib/vertika-api.ts');
    const qs = period?.trim()
      ? `?period=${encodeURIComponent(period.trim())}`
      : '';
    const entries = await vertikaFetch<EntryDto[]>(
      `/api/v1/companies/${encodeURIComponent(companyId.trim())}/entries${qs}`,
      { signal: ctx.abortSignal, sessionAuth: ctx.session.auth },
    );

    const filtrados = tipo ? entries.filter((e) => e.tipo === tipo) : entries;
    const cap = Math.min(limite ?? 12, 25);

    return {
      totalEncontrados: filtrados.length,
      mostrados: Math.min(filtrados.length, cap),
      comprobantes: filtrados.slice(-cap).map((e) => ({
        id: e.id,
        periodo: e.periodo,
        tipo: e.tipo,
        consecutivo: e.consecutivo,
        fecha: e.fecha,
        estado: e.estado,
        origen: e.origen,
        descripcion: e.descripcion,
        totalDebito: e.totalDebito,
        totalCredito: e.totalCredito,
        ...(e.referencia ? { referencia: e.referencia } : {}),
      })),
    };
  },
});
