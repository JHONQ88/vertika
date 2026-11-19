import { useMemo, useState } from 'react';
import { fmtMoney, fmtPct, fmtPeriodo } from '../domain/format';
import { ejecucionPresupuestal, resumenPeriodo } from '../domain/engine';
import { acciones, rubrosDe, unidadesDe, DATOS, tienePermiso, useAuth } from '../store';
import type { VistaProps } from '../ui-types';
import { Badge, Btn, Card, ProgressBar, Stat, ViewHeader } from '../components/ui';

export function Presupuesto(props: VistaProps) {
  const { empresa, estado, toast } = props;
  const auth = useAuth();
  const puedeEditar = tienePermiso(auth.user.rol, 'maestros');
  const [editState, setEditState] = useState<{ id: string; valor: string } | null>(null);
  const [guardandoId, setGuardandoId] = useState<string | null>(null);

  const rubros = useMemo(() => rubrosDe(estado), [estado]);
  const filas = useMemo(
    () => ejecucionPresupuestal(estado.comprobantes, empresa, rubros, estado.periodo),
    [estado.comprobantes, empresa, rubros, estado.periodo],
  );
  const resumen = useMemo(
    () => resumenPeriodo(estado.comprobantes, empresa, unidadesDe(estado), DATOS.terceros, estado.periodo),
    [estado, empresa],
  );

  const presupuesto = filas.reduce((s, f) => s + f.presupuesto, 0);
  const ejecutado = filas.reduce((s, f) => s + f.ejecutado, 0);
  const disponible = presupuesto - ejecutado;
  const pct = presupuesto > 0 ? (ejecutado / presupuesto) * 100 : 0;
  const filasCriticas = filas.filter((f) => f.estado !== 'normal');
  const mes = Number(estado.periodo.split('-')[1]);

  const guardarRubro = async (rubroId: string, nombre: string) => {
    if (!editState) return;
    const monto = Number(editState.valor);
    if (!Number.isFinite(monto) || monto < 0) {
      toast({ tone: 'error', title: 'Valor inválido', msg: 'Ingresa un presupuesto anual numérico >= 0.' });
      return;
    }
    setGuardandoId(rubroId);
    try {
      const res = await acciones.actualizarPresupuestoRubro(rubroId, monto);
      if (res.ok) {
        toast({ tone: 'ok', title: 'Presupuesto actualizado', msg: `${nombre}: ${fmtMoney(monto)}` });
        setEditState(null);
      } else {
        toast({ tone: 'error', title: 'No se pudo actualizar', msg: res.error });
      }
    } finally {
      setGuardandoId(null);
    }
  };

  return (
    <div className="vista">
      <ViewHeader
        icon="pie"
        title="Ejecución presupuestal"
        subtitle={`${empresa.nombreCorto} · ${fmtPeriodo(estado.periodo)} · presupuesto anual de ${fmtMoney(presupuesto)}`}
        actions={
          filasCriticas.length > 0 ? (
            <Badge tone="warn">{filasCriticas.length} rubros en alerta</Badge>
          ) : (
            <Badge tone="ok">Ejecución saludable</Badge>
          )
        }
      />

      <div className="stat-grid">
        <Stat label="Presupuesto anual" value={fmtMoney(presupuesto)} icon="pie" />
        <Stat label="Ejecutado" value={fmtMoney(ejecutado)} hint={`${fmtPct(pct)} del anual`} tone="accent" icon="check" />
        <Stat label="Disponible" value={fmtMoney(disponible)} hint={`${fmtPct(100 - pct)} restante`} tone={disponible < 0 ? 'error' : 'neutral'} icon="wallet" />
        <Stat
          label="Avance esperado"
          value={fmtPct((mes / 12) * 100)}
          hint={`${mes} de 12 meses`}
          tone="neutral"
          icon="clock"
        />
      </div>

      <Card title="Rubros por centro de costo" subtitle="La ejecución se actualiza al asentar cada comprobante">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Rubro</th>
                <th>Centro de costo</th>
                <th className="num">Presupuesto</th>
                <th className="num">Ejecutado</th>
                <th className="num">Disponible</th>
                <th className="w-32">Avance</th>
                <th>Estado</th>
                {puedeEditar && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.rubro.id}>
                  <td>
                    <strong>{f.rubro.nombre}</strong>
                    <small className="mono">{f.rubro.cuenta}</small>
                  </td>
                  <td className="celda-desc">{f.rubro.centro}</td>
                  <td className="num">
                    {editState?.id === f.rubro.id ? (
                      <input
                        type="number"
                        min={0}
                        step={100000}
                        value={editState.valor}
                        onChange={(e) => setEditState({ id: f.rubro.id, valor: e.target.value })}
                        style={{ width: 130, textAlign: 'right' }}
                        aria-label={`Presupuesto anual de ${f.rubro.nombre}`}
                      />
                    ) : (
                      fmtMoney(f.presupuesto)
                    )}
                  </td>
                  <td className="num">{fmtMoney(f.ejecutado)}</td>
                  <td className={`num ${f.disponible < 0 ? 'text-error' : ''}`}>{fmtMoney(f.disponible)}</td>
                  <td>
                    <div className="progress-cell">
                      <ProgressBar pct={f.pct} />
                      <small>{fmtPct(f.pct)}</small>
                    </div>
                  </td>
                  <td>
                    {f.estado === 'critico' && <Badge tone="error">Sobrepasado</Badge>}
                    {f.estado === 'alerta' && <Badge tone="warn">Alerta</Badge>}
                    {f.estado === 'normal' && <Badge tone="ok">Normal</Badge>}
                  </td>
                  {puedeEditar && (
                    <td>
                      {editState?.id === f.rubro.id ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Btn
                            size="xs"
                            variant="primary"
                            disabled={guardandoId === f.rubro.id}
                            onClick={() => void guardarRubro(f.rubro.id, f.rubro.nombre)}
                          >
                            Guardar
                          </Btn>
                          <Btn size="xs" variant="ghost" onClick={() => setEditState(null)}>
                            Cancelar
                          </Btn>
                        </div>
                      ) : (
                        <Btn
                          size="xs"
                          variant="ghost"
                          onClick={() => setEditState({ id: f.rubro.id, valor: String(f.presupuesto) })}
                        >
                          Editar
                        </Btn>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="dos-col">
        <Card title="Ingresos del periodo" subtitle="Liquidación vs recaudo">
          <div className="mini-stats">
            <div>
              <small>Facturado</small>
              <strong>{fmtMoney(resumen.facturado)}</strong>
            </div>
            <div>
              <small>Recaudado</small>
              <strong className="text-ok">{fmtMoney(resumen.recaudado)}</strong>
            </div>
            <div>
              <small>Descuentos pronto pago</small>
              <strong>{fmtMoney(resumen.descuentos)}</strong>
            </div>
            <div>
              <small>Cartera</small>
              <strong className="text-warn">{fmtMoney(resumen.cartera)}</strong>
            </div>
          </div>
          <div className="progress-cell" style={{ marginTop: 14 }}>
            <ProgressBar pct={resumen.facturado > 0 ? (resumen.recaudado / resumen.facturado) * 100 : 0} />
            <small>
              {fmtPct(resumen.facturado > 0 ? (resumen.recaudado / resumen.facturado) * 100 : 0)} recaudado del facturado
            </small>
          </div>
        </Card>

        <Card title="Unidades" subtitle="Estado de cartera al cierre del periodo">
          <div className="mini-stats">
            <div>
              <small>Al día</small>
              <strong className="text-ok">{resumen.unidadesAlDia}</strong>
            </div>
            <div>
              <small>En mora</small>
              <strong className="text-warn">{resumen.unidadesEnMora}</strong>
            </div>
          </div>
          <p className="card-note">
            Los rubros con ejecución superior al 90% del anual o por encima del avance esperado quedan en alerta
            automáticamente.
          </p>
        </Card>
      </div>
    </div>
  );
}
