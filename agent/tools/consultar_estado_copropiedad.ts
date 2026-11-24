import { defineTool } from 'eve/tools';
import { z } from 'zod';

interface BootstrapPayload {
  mode?: string;
  datos: {
    companies: Array<{
      id: string;
      nit: string;
      razonSocial: string;
      nombreCorto: string;
      periodoActual: string;
      presupuestoAnual: number;
      fondoImprevistosPct: number;
      tasaMoraMensual: number;
    }>;
    units: Array<{ id: string; empresaId: string }>;
    terceros: Array<{
      id: string;
      empresaId?: string | null;
      nombre: string;
      tipo: string;
      documento: string;
      dv?: string;
      retefuentePct: number;
      reteicaPct: number;
      reteivaPct: number;
    }>;
    rubros: Array<{
      id: string;
      empresaId: string;
      key: string;
      nombre: string;
      cuenta: string;
      presupuestoAnual: number;
    }>;
  };
  estado: {
    activeCompanyId: string;
    periodo: string;
    preAsientos: Array<{
      id: string;
      empresaId: string;
      periodo: string;
      tipo: string;
      fecha: string;
      agente: string;
      descripcion: string;
      estado: string;
    }>;
    periodosCerrados: Record<string, string[]>;
    auditoria: Array<{
      id: string;
      ts: string;
      actor: string;
      accion: string;
      detalle: string;
      empresaId: string;
    }>;
  };
}

export default defineTool({
  description:
    'Consulta las copropiedades configuradas, periodo actual, periodos cerrados, terceros (con tarifas de retención), rubros presupuestales, unidades y pre-asientos pendientes desde el backend de Vértika.',
  inputSchema: z.object({
    companyId: z
      .string()
      .optional()
      .describe('ID de copropiedad opcional (ej. altavista, colina, plaza-norte).'),
  }),
  label: {
    start: ({ companyId }) =>
      companyId
        ? `Consultando copropiedad ${companyId}`
        : 'Consultando estado de copropiedades',
  },
  async execute({ companyId }, ctx) {
    const { vertikaFetch } = await import('../lib/vertika-api.ts');
    const data = await vertikaFetch<BootstrapPayload>('/api/v1/bootstrap', {
      signal: ctx.abortSignal,
      sessionAuth: ctx.session.auth,
    });

    const target = companyId?.trim();
    const companies = target
      ? data.datos.companies.filter((c) => c.id === target)
      : data.datos.companies;

    if (target && companies.length === 0) {
      return {
        encontrada: false,
        companyId: target,
        disponibles: data.datos.companies.map((c) => c.id),
      };
    }

    const activeIds = new Set(companies.map((c) => c.id));

    return {
      modoBackend: data.mode ?? 'desconocido',
      empresaActivaPorDefecto: data.estado.activeCompanyId,
      copropiedades: companies,
      unidadesPorEmpresa: companies.map((c) => ({
        empresaId: c.id,
        totalUnidades: data.datos.units.filter((u) => u.empresaId === c.id).length,
      })),
      terceros: data.datos.terceros.filter(
        (t) => !t.empresaId || activeIds.has(t.empresaId),
      ),
      rubros: data.datos.rubros.filter((r) => activeIds.has(r.empresaId)),
      preAsientosPendientes: data.estado.preAsientos.filter((p) =>
        activeIds.has(p.empresaId),
      ),
      periodosCerrados: Object.fromEntries(
        Object.entries(data.estado.periodosCerrados).filter(([id]) =>
          activeIds.has(id),
        ),
      ),
      ultimosEventosAuditoria: data.estado.auditoria
        .filter((a) => activeIds.has(a.empresaId))
        .slice(0, 10),
    };
  },
});
