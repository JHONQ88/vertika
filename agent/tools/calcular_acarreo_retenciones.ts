import { defineTool } from 'eve/tools';
import { z } from 'zod';

const LineaBorradorSchema = z.object({
  cuenta: z.string().min(4).describe('Código de cuenta PUC ESAL (ej. 513505).'),
  descripcion: z.string().min(1).describe('Detalle contable de la línea.'),
  debito: z.number().min(0).describe('Valor al débito en COP.'),
  credito: z.number().min(0).describe('Valor al crédito en COP.'),
  terceroId: z.string().optional().describe('ID del tercero asociado si aplica.'),
  unidadId: z.string().optional().describe('ID de la unidad inmobiliaria si aplica.'),
  rubroId: z.string().optional().describe('ID del rubro presupuestal si aplica.'),
});

export default defineTool({
  description:
    'Ejecuta el acarreo determinista de retenciones en el backend Rust (ReteFuente, ReteICA, ReteIVA según el tercero) y recalcula el neto por pagar al proveedor (cuenta 220505).',
  inputSchema: z.object({
    companyId: z.string().min(1).describe('ID de copropiedad (ej. altavista).'),
    terceroId: z.string().min(1).describe('ID del tercero proveedor/prestador.'),
    descripcion: z.string().min(1).describe('Concepto de la factura o documento.'),
    lineas: z
      .array(LineaBorradorSchema)
      .min(2)
      .describe('Líneas iniciales de gasto y contrapartida antes de retenciones.'),
  }),
  label: {
    start: ({ terceroId }) => `Calculando retenciones para ${terceroId}`,
  },
  async execute({ companyId, terceroId, descripcion, lineas }, ctx) {
    const { vertikaFetch } = await import('../lib/vertika-api.ts');
    const payload = {
      company_id: companyId.trim(),
      third_party_id: terceroId.trim(),
      description: descripcion.trim(),
      lines: lineas.map((l) => ({
        account: l.cuenta.trim(),
        description: l.descripcion.trim(),
        debit: l.debito,
        credit: l.credito,
        third_party_id: l.terceroId ?? null,
        unit_id: l.unidadId ?? null,
        rubric_id: l.rubroId ?? null,
      })),
    };

    return vertikaFetch<Record<string, unknown>>('/api/v1/pre-entries/carry-forward', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: ctx.abortSignal,
      sessionAuth: ctx.session.auth,
    });
  },
});
