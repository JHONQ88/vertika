import { useMemo, useState } from 'react';
import { fmtMoney, fmtPeriodo, ultimoDia } from '../domain/format';
import { ejecucionPresupuestal, previewCierre } from '../domain/engine';
import {
  certificadosRetencion,
  descargarArchivo,
  estadoResultados,
  estadoSituacionFinanciera,
  generarCertificadosRetencionHTML,
  generarEjecucionPresupuestalCSV,
  generarEstadosFinancierosHTML,
  generarMediosMagneticosXML,
} from '../domain/reports';
import { acciones, DATOS, esPeriodoBloqueado, rubrosDe, tienePermiso, unidadesDe, useAuth } from '../store';
import { CUENTA_MAP } from '../domain/puc';
import type { VistaProps } from '../ui-types';
import { Badge, Btn, Card, Stat, Toggle, ViewHeader } from '../components/ui';
import { Icon } from '../components/Icon';

export function Cierre(props: VistaProps) {
  const { empresa, estado, toast } = props;
  const auth = useAuth();
  const [depreciacion, setDepreciacion] = useState(true);
  const [provision, setProvision] = useState(true);
  const [traslado, setTraslado] = useState(true);
  const [abriendo, setAbriendo] = useState(false);

  const preview = useMemo(
    () => previewCierre(estado.comprobantes, empresa, unidadesDe(estado), DATOS.terceros, estado.periodo),
    [estado, empresa],
  );
  const bloqueado = esPeriodoBloqueado(estado, estado.periodo);
  const puedeContabilizar = tienePermiso(auth.user.rol, 'contabilidad');
  const cerrados = estado.periodosCerrados[empresa.id] ?? [];
  const periodoActualCerrado = cerrados.includes(empresa.periodoActual);
  const cierreExistente = estado.comprobantes.find(
    (c) => c.empresaId === empresa.id && c.periodo === estado.periodo && c.origen === 'CIERRE_AUTOMATICO',
  );

  const anio = estado.periodo.split('-')[0];

  const ejecutar = async () => {
    const res = await acciones.ejecutarCierre(estado.periodo, { depreciacion, provision, traslado });
    if (res.ok) {
      toast({ tone: 'ok', title: 'Cierre ejecutado', msg: `${res.detalle} · periodo bloqueado` });
    } else {
      toast({ tone: 'error', title: 'No se pudo cerrar', msg: res.error });
    }
  };

  const abrirSiguiente = async () => {
    setAbriendo(true);
    try {
      const res = await acciones.abrirSiguientePeriodo();
      if (res.ok) {
        toast({ tone: 'ok', title: 'Nuevo periodo abierto', msg: res.detalle });
      } else {
        toast({ tone: 'error', title: 'No se pudo abrir el periodo', msg: res.error });
      }
    } finally {
      setAbriendo(false);
    }
  };

  const descargarEEFF = () => {
    const esf = estadoSituacionFinanciera(estado.comprobantes, empresa, estado.periodo);
    const er = estadoResultados(estado.comprobantes, empresa, estado.periodo);
    descargarArchivo(
      `estados-financieros-${empresa.id}-${estado.periodo}.html`,
      generarEstadosFinancierosHTML(empresa, estado.periodo, esf, er),
      'text/html;charset=utf-8',
    );
    toast({ tone: 'ok', title: 'Estados financieros descargados' });
  };

  const descargarPresupuesto = () => {
    const filas = ejecucionPresupuestal(estado.comprobantes, empresa, rubrosDe(estado), estado.periodo);
    descargarArchivo(
      `ejecucion-presupuestal-${empresa.id}-${estado.periodo}.csv`,
      generarEjecucionPresupuestalCSV(filas),
      'text/csv;charset=utf-8',
    );
    toast({ tone: 'ok', title: 'Ejecución presupuestal exportada' });
  };

  const descargarExogena = () => {
    const xml = generarMediosMagneticosXML(estado.comprobantes, empresa, DATOS.terceros, anio);
    descargarArchivo(
      `medios-magneticos-1001-${empresa.id}-${anio}.xml`,
      xml,
      'application/xml;charset=utf-8',
    );
    toast({ tone: 'ok', title: 'XML DIAN Formato 1001 generado', msg: `Año ${anio}` });
  };

  const descargarCertificados = () => {
    const filas = certificadosRetencion(estado.comprobantes, empresa, DATOS.terceros, anio);
    descargarArchivo(
      `certificados-retencion-${empresa.id}-${anio}.html`,
      generarCertificadosRetencionHTML(empresa, anio, filas),
      'text/html;charset=utf-8',
    );
    toast({ tone: 'ok', title: 'Certificados de retención generados', msg: `${filas.length} terceros` });
  };

  return (
    <div className="vista">
      <ViewHeader
        icon="lock"
        title="Cierre mensual"
        subtitle={`${empresa.nombreCorto} · ${fmtPeriodo(estado.periodo)} · cierre programado para el ${ultimoDia(estado.periodo)}`}
        actions={
          <>
            {bloqueado ? (
              <Badge tone="neutral">Periodo cerrado</Badge>
            ) : (
              <Badge tone="ok">Periodo abierto</Badge>
            )}
            {periodoActualCerrado && estado.periodo === empresa.periodoActual && (
              <Btn
                size="sm"
                variant="primary"
                icon="calendar"
                disabled={!puedeContabilizar || abriendo}
                onClick={() => void abrirSiguiente()}
              >
                {abriendo ? 'Abriendo…' : 'Abrir siguiente periodo'}
              </Btn>
            )}
          </>
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
              <Toggle checked={depreciacion} onChange={setDepreciacion} disabled={bloqueado || !puedeContabilizar} />
              <div>
                <strong>Depreciación de PP&E</strong>
                <small>
                  Débito 516005 · Crédito 159215 · {fmtMoney(preview.depreciacion)}
                </small>
              </div>
            </div>
            <div className="check-item">
              <Toggle checked={provision} onChange={setProvision} disabled={bloqueado || !puedeContabilizar} />
              <div>
                <strong>Provisión de cartera morosa</strong>
                <small>
                  Débito 519905 · Crédito 139905 · 5% de {fmtMoney(preview.carteraTotal)} = {fmtMoney(preview.provision)}
                </small>
              </div>
            </div>
            <div className="check-item">
              <Toggle checked={traslado} onChange={setTraslado} disabled={bloqueado || !puedeContabilizar} />
              <div>
                <strong>Traslado al fondo de imprevistos</strong>
                <small>
                  Débito 111010 · Crédito 111005 · {fmtMoney(preview.trasladoFondo)}
                </small>
              </div>
            </div>
          </div>

          <div className="cierre-acciones">
            <Btn
              variant="primary"
              icon="lock"
              onClick={() => void ejecutar()}
              disabled={bloqueado || !puedeContabilizar}
              title={!puedeContabilizar ? 'Solo el contador puede ejecutar cierres' : undefined}
            >
              {bloqueado ? 'Periodo cerrado' : 'Ejecutar cierre y bloquear periodo'}
            </Btn>
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

      <Card title="Salidas para la asamblea" subtitle="Descarga directa de informes ESAL y tributarios">
        <div className="salidas">
          <div>
            <Icon name="scale" size={17} />
            <div style={{ flex: 1 }}>
              <strong>Estados financieros ESAL</strong>
              <small>Situación financiera y resultados bajo OT-15 CTCP.</small>
              <div style={{ marginTop: 8 }}>
                <Btn size="xs" icon="download" onClick={descargarEEFF}>
                  Descargar HTML
                </Btn>
              </div>
            </div>
          </div>
          <div>
            <Icon name="pie" size={17} />
            <div style={{ flex: 1 }}>
              <strong>Ejecución presupuestal</strong>
              <small>Comparativo rubro vs ejecutado con alertas.</small>
              <div style={{ marginTop: 8 }}>
                <Btn size="xs" icon="download" onClick={descargarPresupuesto}>
                  Descargar CSV
                </Btn>
              </div>
            </div>
          </div>
          <div>
            <Icon name="file" size={17} />
            <div style={{ flex: 1 }}>
              <strong>Medios magnéticos DIAN</strong>
              <small>Borrador XML Formato 1001 por tercero ({anio}).</small>
              <div style={{ marginTop: 8 }}>
                <Btn size="xs" icon="download" onClick={descargarExogena}>
                  Descargar XML
                </Btn>
              </div>
            </div>
          </div>
          <div>
            <Icon name="wallet" size={17} />
            <div style={{ flex: 1 }}>
              <strong>Certificados de retención</strong>
              <small>Consolidado anual por proveedor ({anio}).</small>
              <div style={{ marginTop: 8 }}>
                <Btn size="xs" icon="download" onClick={descargarCertificados}>
                  Descargar HTML
                </Btn>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
