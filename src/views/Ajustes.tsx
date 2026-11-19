import { useState } from 'react';
import { fmtFechaHora, fmtMoney, fmtPeriodo, fmtPct } from '../domain/format';
import { acciones, exportarEstado, tienePermiso, useAuth } from '../store';
import type { VistaProps } from '../ui-types';
import { Badge, Btn, Card, ViewHeader } from '../components/ui';

export function Ajustes(props: VistaProps) {
  const { empresa, estado, toast } = props;
  const auth = useAuth();
  const puedeEditar = tienePermiso(auth.user.rol, 'maestros');
  const [confirmando, setConfirmando] = useState(false);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [guardandoEmpresa, setGuardandoEmpresa] = useState(false);
  const [formEmpresa, setFormEmpresa] = useState({
    razonSocial: empresa.razonSocial,
    direccion: empresa.direccion,
    fondoImprevistosPct: String(empresa.fondoImprevistosPct),
    tasaMoraMensual: String(empresa.tasaMoraMensual),
    diaCorteProntoPago: String(empresa.diaCorteProntoPago),
    descuentoProntoPagoPct: String(empresa.descuentoProntoPagoPct),
    llaveBreB: empresa.llaveBreB,
  });
  const editando = editingCompanyId === empresa.id && puedeEditar;
  const auditoriaEmpresa = estado.auditoria.filter((e) => e.empresaId === empresa.id);

  const abrirEdicionEmpresa = () => {
    setFormEmpresa({
      razonSocial: empresa.razonSocial,
      direccion: empresa.direccion,
      fondoImprevistosPct: String(empresa.fondoImprevistosPct),
      tasaMoraMensual: String(empresa.tasaMoraMensual),
      diaCorteProntoPago: String(empresa.diaCorteProntoPago),
      descuentoProntoPagoPct: String(empresa.descuentoProntoPagoPct),
      llaveBreB: empresa.llaveBreB,
    });
    setEditingCompanyId(empresa.id);
  };

  const guardarParametros = async (e: React.FormEvent) => {
    e.preventDefault();
    const fondoImprevistosPct = Number(formEmpresa.fondoImprevistosPct);
    const tasaMoraMensual = Number(formEmpresa.tasaMoraMensual);
    const diaCorteProntoPago = Math.trunc(Number(formEmpresa.diaCorteProntoPago));
    const descuentoProntoPagoPct = Number(formEmpresa.descuentoProntoPagoPct);
    if (
      !formEmpresa.razonSocial.trim() ||
      !formEmpresa.direccion.trim() ||
      !Number.isFinite(fondoImprevistosPct) ||
      fondoImprevistosPct < 0 ||
      !Number.isFinite(tasaMoraMensual) ||
      tasaMoraMensual < 0 ||
      !Number.isFinite(diaCorteProntoPago) ||
      diaCorteProntoPago < 1 ||
      diaCorteProntoPago > 31 ||
      !Number.isFinite(descuentoProntoPagoPct) ||
      descuentoProntoPagoPct < 0
    ) {
      toast({
        tone: 'error',
        title: 'Parámetros inválidos',
        msg: 'Verifica razón social, dirección, porcentajes >= 0 y día de corte (1 a 31).',
      });
      return;
    }
    setGuardandoEmpresa(true);
    try {
      const res = await acciones.actualizarParametrosEmpresa({
        razonSocial: formEmpresa.razonSocial.trim(),
        direccion: formEmpresa.direccion.trim(),
        fondoImprevistosPct,
        tasaMoraMensual,
        diaCorteProntoPago,
        descuentoProntoPagoPct,
        llaveBreB: formEmpresa.llaveBreB.trim(),
      });
      if (res.ok) {
        toast({ tone: 'ok', title: 'Parámetros guardados', msg: res.detalle });
        setEditingCompanyId(null);
      } else {
        toast({ tone: 'error', title: 'No se pudo guardar', msg: res.error });
      }
    } finally {
      setGuardandoEmpresa(false);
    }
  };

  const descargarJSON = () => {
    const blob = new Blob([exportarEstado()], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vertika-estado-${empresa.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ tone: 'ok', title: 'Estado exportado', msg: 'Archivo JSON con comprobantes y auditoría.' });
  };

  const restablecer = async () => {
    if (!confirmando) {
      setConfirmando(true);
      return;
    }
    await acciones.restablecer();
    setConfirmando(false);
    toast({ tone: 'info', title: 'Demo restablecida', msg: 'Los comprobantes y pre-asientos volvieron al estado inicial.' });
  };

  const campos: Array<{ label: string; valor: React.ReactNode }> = [
    { label: 'NIT', valor: empresa.nit },
    { label: 'Razón social', valor: empresa.razonSocial },
    { label: 'Dirección', valor: empresa.direccion },
    { label: 'Ciudad', valor: empresa.ciudad },
    { label: 'Grupo NIIF', valor: `Grupo ${empresa.grupoNiif} · ESAL` },
    { label: 'Periodo actual', valor: fmtPeriodo(empresa.periodoActual) },
    { label: 'Tasa de mora mensual', valor: fmtPct(empresa.tasaMoraMensual) },
    { label: 'Día de corte pronto pago', valor: empresa.diaCorteProntoPago },
    { label: 'Descuento pronto pago', valor: fmtPct(empresa.descuentoProntoPagoPct) },
    { label: 'Fondo de imprevistos', valor: fmtPct(empresa.fondoImprevistosPct) },
    { label: 'Llave Bre-B', valor: empresa.llaveBreB },
    { label: 'Presupuesto anual', valor: fmtMoney(empresa.presupuestoAnual) },
  ];

  return (
    <div className="vista">
      <ViewHeader
        icon="settings"
        title="Ajustes y auditoría"
        subtitle={`${empresa.nombreCorto} · configuración del conjunto y trazabilidad`}
      />

      <div className="dos-col">
        <Card title="Datos del conjunto" subtitle="Parametrización contable y financiera">
          {!editando ? (
            <>
              <div className="campos">
                {campos.map((c) => (
                  <div key={c.label} className="campo">
                    <small>{c.label}</small>
                    <strong>{c.valor}</strong>
                  </div>
                ))}
              </div>
              {puedeEditar && (
                <div className="cierre-acciones" style={{ marginTop: 14 }}>
                  <Btn size="sm" variant="outline" icon="settings" onClick={abrirEdicionEmpresa}>
                    Editar parámetros
                  </Btn>
                </div>
              )}
            </>
          ) : (
            <form onSubmit={(e) => void guardarParametros(e)}>
              <div className="campos">
                <label className="campo">
                  <small>Razón social</small>
                  <input
                    required
                    value={formEmpresa.razonSocial}
                    onChange={(e) => setFormEmpresa((prev) => ({ ...prev, razonSocial: e.target.value }))}
                    style={{ width: '100%', marginTop: 4 }}
                  />
                </label>
                <label className="campo">
                  <small>Dirección</small>
                  <input
                    required
                    value={formEmpresa.direccion}
                    onChange={(e) => setFormEmpresa((prev) => ({ ...prev, direccion: e.target.value }))}
                    style={{ width: '100%', marginTop: 4 }}
                  />
                </label>
                <label className="campo">
                  <small>Tasa de mora mensual (%)</small>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    value={formEmpresa.tasaMoraMensual}
                    onChange={(e) => setFormEmpresa((prev) => ({ ...prev, tasaMoraMensual: e.target.value }))}
                    style={{ width: '100%', marginTop: 4 }}
                  />
                </label>
                <label className="campo">
                  <small>Día de corte pronto pago</small>
                  <input
                    required
                    type="number"
                    step="1"
                    min="1"
                    max="31"
                    value={formEmpresa.diaCorteProntoPago}
                    onChange={(e) => setFormEmpresa((prev) => ({ ...prev, diaCorteProntoPago: e.target.value }))}
                    style={{ width: '100%', marginTop: 4 }}
                  />
                </label>
                <label className="campo">
                  <small>Descuento pronto pago (%)</small>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    value={formEmpresa.descuentoProntoPagoPct}
                    onChange={(e) => setFormEmpresa((prev) => ({ ...prev, descuentoProntoPagoPct: e.target.value }))}
                    style={{ width: '100%', marginTop: 4 }}
                  />
                </label>
                <label className="campo">
                  <small>Fondo de imprevistos (%)</small>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    value={formEmpresa.fondoImprevistosPct}
                    onChange={(e) => setFormEmpresa((prev) => ({ ...prev, fondoImprevistosPct: e.target.value }))}
                    style={{ width: '100%', marginTop: 4 }}
                  />
                </label>
                <label className="campo">
                  <small>Llave Bre-B</small>
                  <input
                    value={formEmpresa.llaveBreB}
                    onChange={(e) => setFormEmpresa((prev) => ({ ...prev, llaveBreB: e.target.value }))}
                    style={{ width: '100%', marginTop: 4 }}
                  />
                </label>
              </div>
              <div className="cierre-acciones" style={{ marginTop: 14 }}>
                <Btn size="sm" variant="ghost" type="button" onClick={() => setEditingCompanyId(null)}>
                  Cancelar
                </Btn>
                <Btn size="sm" variant="primary" type="submit" icon="check" disabled={guardandoEmpresa}>
                  {guardandoEmpresa ? 'Guardando…' : 'Guardar parámetros'}
                </Btn>
              </div>
            </form>
          )}
        </Card>

        <Card title="Datos y sincronización" subtitle="Persistencia local y/o backend">
          <p className="card-note">
            Los datos se guardan en <span className="mono">localStorage</span> y, si <span className="mono">VITE_API_URL</span> está
            configurado, se sincronizan con el backend (Rust) y la base de datos PostgreSQL. En producción, el motor contable corre
            en servidor con aislamiento transaccional y Row-Level Security por conjunto.
          </p>
          <div className="cierre-acciones">
            <Btn icon="download" onClick={descargarJSON}>
              Exportar estado (JSON)
            </Btn>
            <Btn variant={confirmando ? 'danger' : 'outline'} icon="refresh" onClick={restablecer}>
              {confirmando ? '¿Confirmar restablecimiento?' : 'Restablecer demo'}
            </Btn>
          </div>
          {confirmando && (
            <p className="card-note text-warn">
              Se perderán los comprobantes asentados y los pre-asientos aprobados durante la prueba.
            </p>
          )}
        </Card>
      </div>

      <Card title="Auditoría" subtitle={`${auditoriaEmpresa.length} eventos registrados`}>
        <div className="audit">
          {auditoriaEmpresa.slice(0, 30).map((e) => (
            <div key={e.id} className="audit-item">
              <span className={`audit-dot ${e.accion.includes('Cierre') || e.accion.includes('cierre') ? 'dot-ok' : 'dot-info'}`} />
              <div>
                <strong>{e.accion}</strong>
                <small>{e.detalle}</small>
              </div>
              <div className="audit-meta">
                <span>{e.actor}</span>
                <span>{fmtFechaHora(e.ts)}</span>
              </div>
            </div>
          ))}
          {auditoriaEmpresa.length === 0 && <p className="card-note">Sin eventos.</p>}
        </div>
      </Card>

      <Card title="Acerca de Vértika" subtitle="Visión, verticalidad y tecnología">
        <p className="card-note">
          Vértika conecta todos los niveles financieros y operativos de una copropiedad: el recaudo por NFC y Bre-B, la
          contabilidad ESAL bajo la Ley 675 de 2001, la ejecución presupuestal de asamblea y el pago disperso a
          proveedores. Los agentes de IA interpretan documentos y proponen asientos; el motor determinista valida la
          partida doble antes de guardar.
        </p>
        <div className="badges">
          <Badge tone="ok">Motor contable determinista</Badge>
          <Badge tone="info">PUC ESAL · Orientación Técnica 15</Badge>
          <Badge tone="accent">Agentes IA con supervisión</Badge>
        </div>
        <div className="cierre-acciones">
          <Btn size="sm" variant="ghost" icon="logout" onClick={() => window.location.reload()}>
            Recargar consola
          </Btn>
        </div>
      </Card>
    </div>
  );
}
