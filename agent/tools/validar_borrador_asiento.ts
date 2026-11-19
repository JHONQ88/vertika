import { defineTool } from 'eve/tools';
import { z } from 'zod';

const LineaValidacionSchema = z.object({
  cuenta: z.string().min(4).describe('Código PUC ESAL.'),
  descripcion: z.string().min(1).describe('Concepto de la línea.'),
  debito: z.number().min(0).describe('Débito en COP.'),
  credito: z.number().min(0).describe('Crédito en COP.'),
  terceroId: z.string().optional(),
  unidadId: z.string().optional(),
  rubroId: z.string().optional(),
});

export default defineTool({
  description:
    'Valida un borrador de asiento contra el motor determinista de Vértika (cuentas PUC existentes, partida doble débito = crédito y hash SHA-256). No guarda ni asienta cambios.',
  inputSchema: z.object({
    companyId: z.string().min(1).describe('ID de copropiedad (ej. altavista).'),
    period: z.string().regex(/^\d{4}-\d{2}$/).describe('Periodo contable YYYY-MM.'),
    entryType: z.enum(['CC', 'RC', 'CE', 'NC', 'DS']).describe('Tipo de comprobante.'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Fecha YYYY-MM-DD.'),
    description: z.string().min(1).describe('Descripción general del comprobante.'),
    lines: z.array(LineaValidacionSchema).min(2).describe('Mínimo 2 líneas contables.'),
  }),
  label: {
    start: ({ entryType, companyId }) =>
      `Validando borrador ${entryType} en ${companyId}`,
  },
  async execute({ companyId, period, entryType, date, description, lines }, ctx) {
    const { vertikaFetch } = await import('../lib/vertika-api.ts');
    const payload = {
      company_id: companyId.trim(),
      period: period.trim(),
      entry_type: entryType,
      date: date.trim(),
      description: description.trim(),
      lines: lines.map((l) => ({
        account: l.cuenta.trim(),
        description: l.descripcion.trim(),
        debit: l.debito,
        credit: l.credito,
        third_party_id: l.terceroId ?? null,
        unit_id: l.unidadId ?? null,
        rubric_id: l.rubroId ?? null,
      })),
    };

    return vertikaFetch<Record<string, unknown>>('/api/v1/ledger/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
      allowStatuses: [422],
      signal: ctx.abortSignal,
    });
  },
});
