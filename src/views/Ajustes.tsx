import { useState } from 'react';
import { API_URL } from '../api';
import { fmtFechaHora, fmtMoney, fmtPeriodo, fmtPct } from '../domain/format';
import { acciones, exportarEstado, tienePermiso, useAuth } from '../store';
import type { VistaProps } from '../ui-types';
import { Badge, Btn, Card, Toggle, ViewHeader } from '../components/ui';

async function compressImageToDataUrl(
  file: File,
  maxWidth: number,
  mimeType: 'image/png' | 'image/jpeg',
  quality = 0.8,
): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      el.src = objectUrl;
    });
    const ratio = img.width > maxWidth ? maxWidth / img.width : 1;
    const width = Math.max(1, Math.round(img.width * ratio));
    const height = Math.max(1, Math.round(img.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo procesar la imagen en el navegador.');
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL(mimeType, quality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

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
    wompiPublicKey: empresa.wompiPublicKey ?? '',
    wompiIntegritySecret: '',
    wompiEventsSecret: '',
    wompiSandbox: empresa.wompiSandbox ?? true,
    portalLogoUrl: empresa.portalLogoUrl ?? '',
    portalCoverUrl: empresa.portalCoverUrl ?? '',
    portalColorPrimario: empresa.portalColorPrimario ?? '#0F766E',
    portalMensajeBienvenida: empresa.portalMensajeBienvenida ?? '',
    portalWhatsappSoporte: empresa.portalWhatsappSoporte ?? '',
  });
  const editando = editingCompanyId === empresa.id && puedeEditar;
  const auditoriaEmpresa = estado.auditoria.filter((e) => e.empresaId === empresa.id);
  const webhookUrl = `${(API_URL || 'https://vertika-api.onrender.com').replace(/\/+$/, '')}/api/v1/webhooks/wompi`;

  const abrirEdicionEmpresa = () => {
    setFormEmpresa({
      razonSocial: empresa.razonSocial,
      direccion: empresa.direccion,
      fondoImprevistosPct: String(empresa.fondoImprevistosPct),
      tasaMoraMensual: String(empresa.tasaMoraMensual),
      diaCorteProntoPago: String(empresa.diaCorteProntoPago),
      descuentoProntoPagoPct: String(empresa.descuentoProntoPagoPct),
      llaveBreB: empresa.llaveBreB,
      wompiPublicKey: empresa.wompiPublicKey ?? '',
      wompiIntegritySecret: '',
      wompiEventsSecret: '',
      wompiSandbox: empresa.wompiSandbox ?? true,
      portalLogoUrl: empresa.portalLogoUrl ?? '',
      portalCoverUrl: empresa.portalCoverUrl ?? '',
      portalColorPrimario: empresa.portalColorPrimario ?? '#0F766E',
      portalMensajeBienvenida: empresa.portalMensajeBienvenida ?? '',
      portalWhatsappSoporte: empresa.portalWhatsappSoporte ?? '',
    });
    setEditingCompanyId(empresa.id);
  };

  const subirImagenMarca = async (
    file: File | null,
    target: 'portalLogoUrl' | 'portalCoverUrl',
  ) => {
    if (!file) return;
    try {
      const dataUrl =
        target === 'portalLogoUrl'
          ? await compressImageToDataUrl(file, 360, 'image/png', 0.9)
          : await compressImageToDataUrl(file, 1200, 'image/jpeg', 0.78);
      if (dataUrl.length > 290_000) {
        toast({
          tone: 'error',
          title: 'Imagen demasiado pesada',
          msg: 'Usa una imagen más ligera o pega una URL https:// externa.',
        });
        return;
      }
      setFormEmpresa((prev) => ({ ...prev, [target]: dataUrl }));
      toast({ tone: 'ok', title: 'Imagen cargada', msg: 'Guarda los cambios para aplicarla en el portal.' });
    } catch (err: unknown) {
      toast({
        tone: 'error',
        title: 'Error al procesar imagen',
        msg: err instanceof Error ? err.message : 'Formato inválido.',
      });
    }
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
        wompiPublicKey: formEmpresa.wompiPublicKey.trim(),
        wompiIntegritySecret: formEmpresa.wompiIntegritySecret.trim() || undefined,
        wompiEventsSecret: formEmpresa.wompiEventsSecret.trim() || undefined,
        wompiSandbox: formEmpresa.wompiSandbox,
        portalLogoUrl: formEmpresa.portalLogoUrl.trim(),
        portalCoverUrl: formEmpresa.portalCoverUrl.trim(),
        portalColorPrimario: formEmpresa.portalColorPrimario.trim() || '#0F766E',
        portalMensajeBienvenida: formEmpresa.portalMensajeBienvenida.trim(),
        portalWhatsappSoporte: formEmpresa.portalWhatsappSoporte.trim(),
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
    { label: 'Llave Bre-B', valor: empresa.llaveBreB || 'Sin configurar' },
    {
      label: 'Pasarela Wompi (PSE / Nequi)',
      valor: empresa.wompiConfigurado
        ? `${empresa.wompiSandbox ? 'Sandbox' : 'Producción'} · ${empresa.wompiPublicKey}`
        : 'Modo pruebas / Bre-B',
    },
    {
      label: 'Portal marca blanca',
      valor:
        empresa.portalLogoUrl || empresa.portalCoverUrl || empresa.portalWhatsappSoporte
          ? `Personalizado · Color ${empresa.portalColorPrimario || '#0F766E'}`
          : `Estándar · Color ${empresa.portalColorPrimario || '#0F766E'}`,
    },
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
                <label className="campo">
                  <small>Wompi Public Key (pub_test_... / pub_prod_...)</small>
                  <input
                    value={formEmpresa.wompiPublicKey}
                    onChange={(e) => setFormEmpresa((prev) => ({ ...prev, wompiPublicKey: e.target.value }))}
                    placeholder="pub_test_..."
                    style={{ width: '100%', marginTop: 4 }}
                  />
                </label>
                <label className="campo">
                  <small>Wompi Integrity Secret</small>
                  <input
                    type="password"
                    value={formEmpresa.wompiIntegritySecret}
                    onChange={(e) => setFormEmpresa((prev) => ({ ...prev, wompiIntegritySecret: e.target.value }))}
                    placeholder="Dejar vacío para conservar"
                    style={{ width: '100%', marginTop: 4 }}
                  />
                </label>
                <label className="campo">
                  <small>Wompi Events Secret (Webhook)</small>
                  <input
                    type="password"
                    value={formEmpresa.wompiEventsSecret}
                    onChange={(e) => setFormEmpresa((prev) => ({ ...prev, wompiEventsSecret: e.target.value }))}
                    placeholder="Dejar vacío para conservar"
                    style={{ width: '100%', marginTop: 4 }}
                  />
                </label>
                <div className="campo">
                  <small>Modo pasarela Wompi</small>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    <Toggle
                      checked={formEmpresa.wompiSandbox}
                      onChange={(v) => setFormEmpresa((prev) => ({ ...prev, wompiSandbox: v }))}
                    />
                    <span style={{ fontSize: 12.5 }}>
                      {formEmpresa.wompiSandbox ? 'Pruebas (Sandbox)' : 'Producción en vivo'}
                    </span>
                  </div>
                </div>
                <div className="campo" style={{ gridColumn: '1 / -1' }}>
                  <small>URL de Webhook Wompi (copiar en tu panel Wompi)</small>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <input readOnly value={webhookUrl} className="mono" style={{ flex: 1, fontSize: 12 }} />
                    <Btn
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard?.writeText(webhookUrl);
                        toast({ tone: 'ok', title: 'Webhook URL copiada' });
                      }}
                    >
                      Copiar
                    </Btn>
                  </div>
                </div>

                <div
                  className="campo"
                  style={{
                    gridColumn: '1 / -1',
                    borderTop: '1px solid #E4E4E7',
                    paddingTop: 12,
                    marginTop: 4,
                  }}
                >
                  <strong style={{ fontSize: 13 }}>Marca blanca del Portal de Residentes</strong>
                  <small style={{ display: 'block', marginTop: 2 }}>
                    Personaliza el logo, foto de portada, color, mensaje y WhatsApp que ven los residentes al ingresar a pagar.
                  </small>
                </div>

                <div className="campo">
                  <small>Logo del conjunto (URL https:// o archivo PNG/JPG/WebP)</small>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                    <input
                      value={formEmpresa.portalLogoUrl}
                      onChange={(e) => setFormEmpresa((prev) => ({ ...prev, portalLogoUrl: e.target.value }))}
                      placeholder="https://... o sube una imagen"
                      style={{ flex: 1 }}
                    />
                    <label
                      style={{
                        border: '1px solid #E4E4E7',
                        borderRadius: 6,
                        padding: '6px 10px',
                        fontSize: 12,
                        cursor: 'pointer',
                        background: '#FFFFFF',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Subir
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          void subirImagenMarca(e.target.files?.[0] ?? null, 'portalLogoUrl');
                          e.currentTarget.value = '';
                        }}
                      />
                    </label>
                    {formEmpresa.portalLogoUrl && (
                      <Btn
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() => setFormEmpresa((prev) => ({ ...prev, portalLogoUrl: '' }))}
                      >
                        Quitar
                      </Btn>
                    )}
                  </div>
                  {formEmpresa.portalLogoUrl && (
                    <img
                      src={formEmpresa.portalLogoUrl}
                      alt="Vista previa logo"
                      style={{ marginTop: 6, maxHeight: 44, maxWidth: 180, objectFit: 'contain', borderRadius: 4 }}
                    />
                  )}
                </div>

                <div className="campo">
                  <small>Foto de portada del conjunto (URL https:// o archivo JPG/WebP)</small>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                    <input
                      value={formEmpresa.portalCoverUrl}
                      onChange={(e) => setFormEmpresa((prev) => ({ ...prev, portalCoverUrl: e.target.value }))}
                      placeholder="https://... o sube una foto"
                      style={{ flex: 1 }}
                    />
                    <label
                      style={{
                        border: '1px solid #E4E4E7',
                        borderRadius: 6,
                        padding: '6px 10px',
                        fontSize: 12,
                        cursor: 'pointer',
                        background: '#FFFFFF',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Subir
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          void subirImagenMarca(e.target.files?.[0] ?? null, 'portalCoverUrl');
                          e.currentTarget.value = '';
                        }}
                      />
                    </label>
                    {formEmpresa.portalCoverUrl && (
                      <Btn
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() => setFormEmpresa((prev) => ({ ...prev, portalCoverUrl: '' }))}
                      >
                        Quitar
                      </Btn>
                    )}
                  </div>
                  {formEmpresa.portalCoverUrl && (
                    <img
                      src={formEmpresa.portalCoverUrl}
                      alt="Vista previa portada"
                      style={{ marginTop: 6, height: 52, width: 120, objectFit: 'cover', borderRadius: 4, border: '1px solid #E4E4E7' }}
                    />
                  )}
                </div>

                <label className="campo">
                  <small>Color primario del portal</small>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(formEmpresa.portalColorPrimario) ? formEmpresa.portalColorPrimario : '#0F766E'}
                      onChange={(e) => setFormEmpresa((prev) => ({ ...prev, portalColorPrimario: e.target.value.toUpperCase() }))}
                      style={{ width: 38, height: 34, padding: 2, border: '1px solid #E4E4E7', borderRadius: 6 }}
                    />
                    <input
                      value={formEmpresa.portalColorPrimario}
                      onChange={(e) => setFormEmpresa((prev) => ({ ...prev, portalColorPrimario: e.target.value }))}
                      className="mono"
                      placeholder="#0F766E"
                      style={{ flex: 1 }}
                    />
                  </div>
                </label>

                <label className="campo">
                  <small>WhatsApp de soporte al residente</small>
                  <input
                    value={formEmpresa.portalWhatsappSoporte}
                    onChange={(e) => setFormEmpresa((prev) => ({ ...prev, portalWhatsappSoporte: e.target.value }))}
                    placeholder="Ej. +57 300 123 4567"
                    style={{ width: '100%', marginTop: 4 }}
                  />
                </label>

                <label className="campo" style={{ gridColumn: '1 / -1' }}>
                  <small>Mensaje de bienvenida del portal (opcional)</small>
                  <input
                    value={formEmpresa.portalMensajeBienvenida}
                    onChange={(e) => setFormEmpresa((prev) => ({ ...prev, portalMensajeBienvenida: e.target.value }))}
                    placeholder="Consulta tu cuenta de cobro y paga tu administración en línea sin filas."
                    maxLength={280}
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
