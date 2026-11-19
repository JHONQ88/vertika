import { useMemo, useState } from 'react';
import { fmtMoney, fmtPeriodo, ultimoDia } from '../domain/format';
import { previewCierre } from '../domain/engine';
import { acciones, esPeriodoBloqueado, unidadesDe, DATOS } from '../store';
import { CUENTA_MAP } from '../domain/puc';
import type { VistaProps } from '../ui-types';
import { Badge, Btn, Card, Stat, Toggle, ViewHeader } from '../components/ui';
import { Icon } from '../components/Icon';

export function Cierre(props: VistaProps) {
  const { empresa, estado, toast } = props;
  const [depreciacion, setDepreciacion] = useState(true);
  const [provision, setProvision] = useState(true);
  const [traslado, setTraslado] = useState(true);
  const [hecho, setHecho] = useState(false);

  const preview = useMemo(
    () => previewCierre(estado.comprobantes, empresa, unidadesDe(estado), DATOS.terceros, estado.periodo),
    [estado.comprobantes, empresa, estado.periodo],
  );
  const bloqueado = esPeriodoBloqueado(estado, estado.periodo);
  const cierreExistente = estado.comprobantes.find(
    (c) => c.empresaId === empresa.id && c.periodo === estado.periodo && c.origen === 'CIERRE_AUTOMATICO',
  );

  const ejecutar = async () => {
    const res = await acciones.ejecutarCierre(estado.periodo, { depreciacion, provision, traslado });
    if (res.ok) {
      setHecho(true);
      toast({ tone: 'ok', title: 'Cierre ejecutado', msg: `${res.detalle} · periodo bloqueado` });
    } else {
      toast({ tone: 'error', title: 'No se pudo cerrar', msg: res.error });
    }
  };

  return (
    <div className="vista">
      <ViewHeader
        icon="lock"
        title="Cierre mensual"
        subtitle={`${empresa.nombreCorto} · ${fmtPeriodo(estado.periodo)} · cierre programado para el ${ultimoDia(estado.periodo)}`}
        actions={
          bloqueado ? (
            <Badge tone="neutral">Periodo cerrado</Badge>
          ) : (
            <Badge tone="ok">Periodo abierto</Badge>
          )
        }
      />

      {bloqueado && (
        <div className="entry-banner">
          <Icon name="lock" size={15} />
          <span>
            El periodo {fmtPeriodo(estado.periodo)} ya fue cerrado. Queda en solo lectura y su comprobante de cierre
            queda en la auditoría.
          </span>
        </div>
      )}

      <div className="stat-grid">
        <Stat label="Cartera total" value={fmtMoney(preview.carteraTotal)} icon="wallet" />
        <Stat label="Depreciación mensual" value={fmtMoney(preview.depreciacion)} icon="refresh" />
        <Stat label="Provisión de cartera (5%)" value={fmtMoney(preview.provision)} icon="alert" />
        <Stat label="Traslado a fondo de imprevistos" value={fmtMoney(preview.trasladoFondo)} icon="lock" />
      </div>

      <div className="dos-col">
        <Card title="Asistente de cierre" subtitle="Operaciones automáticas del periodo">
          <div className="checklist">
            <div className="check-item">
              <Toggle checked={depreciacion} onChange={setDepreciacion} disabled={bloqueado} />
              <div>
                <strong>Depreciación de PP&E</strong>
                <small>
                  Débito 516005 · Crédito 159215 · {fmtMoney(preview.depreciacion)}
                </small>
              </div>
            </div>
            <div className="check-item">
              <Toggle checked={provision} onChange={setProvision} disabled={bloqueado} />
              <div>
                <strong>Provisión de cartera morosa</strong>
                <small>
                  Débito 519905 · Crédito 139905 · 5% de {fmtMoney(preview.carteraTotal)} = {fmtMoney(preview.provision)}
                </small>
              </div>
            </div>
            <div className="check-item">
              <Toggle checked={traslado} onChange={setTraslado} disabled={bloqueado} />
              <div>
                <strong>Traslado al fondo de imprevistos</strong>
                <small>
                  Débito 111010 · Crédito 111005 · {fmtMoney(preview.trasladoFondo)}
                </small>
              </div>
            </div>
          </div>

          <div className="cierre-acciones">
            <Btn variant="primary" icon="lock" onClick={ejecutar} disabled={bloqueado || hecho}>
              {hecho ? 'Cierre ejecutado' : 'Ejecutar cierre y bloquear periodo'}
            </Btn>
            {hecho && !bloqueado && <Badge tone="ok">Listo</Badge>}
          </div>
        </Card>

        <Card
          title="Comprobante de cierre"
          subtitle={cierreExistente ? `${cierreExistente.tipo}-${cierreExistente.consecutivo}` : 'Aún no generado'}
        >
          {cierreExistente ? (
            <table className="table table-tight">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th className="num">Débito</th>
                  <th className="num">Crédito</th>
                </tr>
              </thead>
              <tbody>
                {cierreExistente.lineas.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className="cuenta-cod">{l.cuenta}</span>
                      <span className="cuenta-nom">{CUENTA_MAP[l.cuenta]?.nombre}</span>
                    </td>
                    <td className="num">{l.debito > 0 ? fmtMoney(l.debito) : '—'}</td>
                    <td className="num">{l.credito > 0 ? fmtMoney(l.credito) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="card-note">
              Al ejecutar el cierre se generará un comprobante <span className="mono">NC</span> con la depreciación,
              la provisión de cartera y el traslado de efectivo al fondo de imprevistos. El periodo quedará bloqueado
              para auditoría y no se podrán asentar más comprobantes.
            </p>
          )}
        </Card>
      </div>

      <Card title="Salidas para la asamblea" subtitle="Se generan automáticamente al cerrar">
        <div className="salidas">
          <div>
            <Icon name="scale" size={17} />
            <div>
              <strong>Balance de prueba</strong>
              <small>Estado de situación financiera por centro de costo.</small>
            </div>
          </div>
          <div>
            <Icon name="pie" size={17} />
            <div>
              <strong>Ejecución presupuestal</strong>
              <small>Comparativo rubro vs ejecutado con alertas.</small>
            </div>
          </div>
          <div>
            <Icon name="file" size={17} />
            <div>
              <strong>Medios magnéticos DIAN</strong>
              <small>XML de información exógena listo para transmitir.</small>
            </div>
          </div>
          <div>
            <Icon name="wallet" size={17} />
            <div>
              <strong>Certificados de retención</strong>
              <small>Anuales por proveedor, listos para descargar.</small>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
