import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { z } from 'zod';

const LineaPropuestaSchema = z.object({
  cuenta: z.string().min(4).describe('Código de cuenta PUC ESAL (ej. 513505).'),
  descripcion: z.string().min(1).describe('Concepto contable de la línea.'),
  debito: z.number().min(0).describe('Débito en COP.'),
  credito: z.number().min(0).describe('Crédito en COP.'),
  terceroId: z.string().optional().describe('ID del tercero si la cuenta lo requiere.'),
  unidadId: z.string().optional().describe('ID de la unidad si la cuenta lo requiere.'),
  rubroId: z.string().optional().describe('ID del rubro presupuestal si aplica.'),
});

export default defineTool({
  description:
    'Radica un borrador de pre-asiento en estado PENDIENTE en la Bandeja IA del contador (`POST /api/v1/pre-entries`). Nunca asienta ni contabiliza en firme; siempre pasa primero por validación de partida doble y queda pendiente de aprobación con F10.',
  inputSchema: z.object({
    companyId: z.string().min(1).describe('ID de copropiedad (ej. altavista).'),
    period: z.string().regex(/^\d{4}-\d{2}$/).describe('Periodo abierto YYYY-MM.'),
    entryType: z
      .enum(['CC', 'RC', 'CE', 'NC', 'DS'])
      .default('CC')
      .describe('Tipo de comprobante sugerido.'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Fecha YYYY-MM-DD.'),
    terceroId: z.string().min(1).describe('ID del tercero principal.'),
    unidadId: z.string().optional().describe('ID de unidad inmobiliaria opcional.'),
    rubroId: z.string().optional().describe('ID de rubro presupuestal opcional.'),
    description: z.string().min(3).describe('Descripción clara del hecho económico.'),
    confianza: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe('Nivel de confianza estimado 0–100 (por defecto 92).'),
    notes: z
      .array(z.string())
      .optional()
      .describe('Notas de soporte contable o supuestos para el contador.'),
    lines: z
      .array(LineaPropuestaSchema)
      .min(2)
      .describe('Mínimo 2 líneas cuadradas (total débito = total crédito).'),
  }),
  label: {
    start: ({ entryType, companyId }) =>
      `Radicando pre-asiento ${entryType} en ${companyId}`,
  },
  approval: {
    request: always(),
    prompt: ({ input }) => {
      const totalDebito = input.lines.reduce((s, l) => s + l.debito, 0);
      return `¿Radicar pre-asiento PENDIENTE (${input.entryType}) en "${input.companyId}" (${input.period}) por $${totalDebito.toLocaleString('es-CO')} — "${input.description}"?`;
    },
  },
  async execute(input, ctx) {
    const { vertikaFetch } = await import('../lib/vertika-api.ts');
    const payload = {
      companyId: input.companyId.trim(),
      period: input.period.trim(),
      entryType: input.entryType,
      date: input.date.trim(),
      agent: 'AGENTE_IA_EVE',
      confianza: input.confianza ?? 92,
      terceroId: input.terceroId.trim(),
      unidadId: input.unidadId?.trim() || undefined,
      rubroId: input.rubroId?.trim() || undefined,
      description: input.description.trim(),
      notes: input.notes ?? [],
      lines: input.lines.map((l, idx) => ({
        id: `eve-${idx + 1}`,
        cuenta: l.cuenta.trim(),
        descripcion: l.descripcion.trim(),
        debito: l.debito,
        credito: l.credito,
        terceroId: l.terceroId?.trim() || undefined,
        unidadId: l.unidadId?.trim() || undefined,
        rubroId: l.rubroId?.trim() || undefined,
      })),
    };

    return vertikaFetch<Record<string, unknown>>('/api/v1/pre-entries', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: ctx.abortSignal,
    });
  },
});
