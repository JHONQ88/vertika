import { useMemo, useRef, useState } from 'react';
import type { Copropiedad, DocItem, Tercero } from '../domain/types';
import { CUENTAS } from '../domain/puc';
import { fmtMoney, fmtPeriodo } from '../domain/format';
import {
  buscarTerceroPorNit,
  construirAsientoFactura,
  construirDocumentoFactura,
  EJEMPLO_XML_DIAN_UBL,
  parsearFacturaXmlUbl,
  sugerirCuentaGasto,
} from '../domain/ubl';
import { acciones } from '../store';
import type { ToastData } from '../ui-types';
import { Badge, Btn, Modal } from './ui';
import { Icon } from './Icon';

const CUENTAS_GASTO = CUENTAS.filter((c) => c.tipo === 'GASTO' || c.codigo.startsWith('15'));

export function CargarFacturaModal({
  open,
  onClose,
  empresa,
  periodo,
  terceros,
  onCreado,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  empresa: Copropiedad;
  periodo: string;
  terceros: Tercero[];
  onCreado: (preAsientoId: string) => void;
  toast: (t: ToastData) => void;
}) {
  const proveedores = useMemo(
    () => terceros.filter((t) => t.tipo === 'PROVEEDOR'),
    [terceros],
  );
  const defaultProv = proveedores[0] ?? terceros[0];

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [xmlStatus, setXmlStatus] = useState<{
    ok: boolean;
    archivo: string;
    mensaje: string;
  } | null>(null);

  const [tipo, setTipo] = useState<'CC' | 'DS'>('CC');
  const [numero, setNumero] = useState('');
  const [fecha, setFecha] = useState(`${periodo}-15`);
  const [terceroId, setTerceroId] = useState(defaultProv?.id ?? '');
  const [emisorManual, setEmisorManual] = useState(defaultProv?.nombre ?? '');
  const [nitManual, setNitManual] = useState(defaultProv?.documento ?? '');
  const [cufe, setCufe] = useState('');
  const [cuentaGasto, setCuentaGasto] = useState('514510');
  const [descripcion, setDescripcion] = useState('');
  const [subtotal, setSubtotal] = useState(0);
  const [iva, setIva] = useState(0);
  const [otrosImpuestos, setOtrosImpuestos] = useState(0);
  const [aplicarRetenciones, setAplicarRetenciones] = useState(true);
  const [items, setItems] = useState<DocItem[]>([]);
  const [xmlRaw, setXmlRaw] = useState<string | undefined>(undefined);
  const [guardando, setGuardando] = useState(false);

  const proveedorSeleccionado = useMemo(
    () => terceros.find((t) => t.id === terceroId),
    [terceros, terceroId],
  );

  const preview = useMemo(
    () =>
      construirAsientoFactura({
        cuentaGasto,
        descripcion: descripcion.trim() || `Factura ${numero || 'sin número'}`,
        subtotal,
        iva,
        otrosImpuestos,
        tercero: proveedorSeleccionado,
        aplicarRetenciones,
        esDocumentoSoporte: tipo === 'DS',
      }),
    [cuentaGasto, descripcion, numero, subtotal, iva, otrosImpuestos, proveedorSeleccionado, aplicarRetenciones, tipo],
  );

  const totalFactura =
    Math.max(0, Math.round(subtotal)) +
    Math.max(0, Math.round(iva)) +
    Math.max(0, Math.round(otrosImpuestos));
  const totalRetenciones = preview.retenciones.reduce((a, r) => a + r.valor, 0);
  const netoPagar = Math.max(0, totalFactura - totalRetenciones);

  const procesarXml = (texto: string, nombreArchivo: string) => {
    try {
      const parsed = parsearFacturaXmlUbl(texto);
      const match = buscarTerceroPorNit(parsed.nit, terceros);
      const cuentaSugerida = sugerirCuentaGasto(`${parsed.descripcion} ${parsed.emisor}`);

      setNumero(parsed.numero);
      setFecha(parsed.fecha.startsWith(periodo) ? parsed.fecha : `${periodo}-20`);
      setEmisorManual(parsed.emisor);
      setNitManual(parsed.nit);
      setCufe(parsed.cufe ?? '');
      setSubtotal(parsed.subtotal);
      setIva(parsed.iva);
      setOtrosImpuestos(parsed.otrosImpuestos);
      setDescripcion(parsed.descripcion);
      setItems(parsed.items);
      setXmlRaw(parsed.xmlOriginal);
      setCuentaGasto(cuentaSugerida);
      setTipo('CC');

      if (match) {
        setTerceroId(match.id);
        setXmlStatus({
          ok: true,
          archivo: nombreArchivo,
          mensaje: `XML UBL 2.1 leído · Proveedor reconocido por NIT (${match.nombre}) · Cuenta sugerida ${cuentaSugerida}`,
        });
      } else {
        setXmlStatus({
          ok: true,
          archivo: nombreArchivo,
          mensaje: `XML UBL 2.1 leído (${parsed.emisor} · NIT ${parsed.nit}). Selecciona o confirma el tercero en el catálogo.`,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'No se pudo leer el archivo XML.';
      setXmlStatus({ ok: false, archivo: nombreArchivo, mensaje: msg });
      toast({ tone: 'error', title: 'Error al leer XML', msg });
    }
  };

  const leerArchivo = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      procesarXml(String(reader.result ?? ''), file.name);
    };
    reader.readAsText(file, 'utf-8');
  };

  const alCambiarTercero = (nuevoId: string) => {
    setTerceroId(nuevoId);
    const t = terceros.find((x) => x.id === nuevoId);
    if (t && !xmlRaw) {
      setEmisorManual(t.nombre);
      setNitManual(t.dv ? `${t.documento}-${t.dv}` : t.documento);
      if (t.noObligado) {
        setTipo('DS');
        setIva(0);
      }
    }
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (subtotal <= 0) {
      toast({ tone: 'error', title: 'Subtotal requerido', msg: 'Ingresa un subtotal mayor a $ 0.' });
      return;
    }
    if (!terceroId) {
      toast({ tone: 'error', title: 'Tercero requerido', msg: 'Selecciona un proveedor.' });
      return;
    }

    setGuardando(true);
    try {
      const numFinal = numero.trim() || `FE-${Date.now().toString().slice(-5)}`;
      const descFinal =
        descripcion.trim() ||
        `${tipo === 'DS' ? 'Documento soporte' : 'Factura'} ${numFinal} · ${proveedorSeleccionado?.nombre ?? emisorManual}`;

      const docItems: DocItem[] =
        items.length > 0
          ? items
          : [{ descripcion: descFinal, cantidad: 1, valorUnitario: Math.round(subtotal) }];

      const documento = construirDocumentoFactura({
        clase: tipo === 'DS' ? 'SOPORTE' : 'FACTURA',
        numero: numFinal,
        emisor: emisorManual.trim() || proveedorSeleccionado?.nombre || 'Proveedor',
        nit:
          nitManual.trim() ||
          (proveedorSeleccionado?.dv
            ? `${proveedorSeleccionado.documento}-${proveedorSeleccionado.dv}`
            : proveedorSeleccionado?.documento || ''),
        fecha,
        cufe: cufe.trim() || undefined,
        items: docItems,
        subtotal: Math.round(subtotal),
        iva: Math.round(iva),
        otrosImpuestos: Math.round(otrosImpuestos),
        retenciones: preview.retenciones,
        xml: xmlRaw,
      });

      const notas = [
        ...(xmlRaw
          ? ['Factura electrónica XML UBL 2.1 analizada y validada automáticamente']
          : ['Factura radicada manualmente en Bandeja de pre-asientos']),
        ...preview.notas,
      ];

      const res = await acciones.radicarPreAsiento({
        companyId: empresa.id,
        period: periodo,
        entryType: tipo,
        date: fecha,
        agent: xmlRaw ? 'AGENTE_IA_DIAN' : 'AGENTE_IA_OCR',
        confianza: xmlRaw ? 98.4 : 95.0,
        terceroId,
        description: descFinal,
        document: documento,
        lines: preview.lineas,
        notes: notas,
      });

      if (res.ok && res.preAsiento) {
        toast({
          tone: 'ok',
          title: 'Factura radicada en Bandeja',
          msg: `${numFinal} lista para revisar y asentar con F10`,
        });
        onCreado(res.preAsiento.id);
        onClose();
      } else {
        toast({ tone: 'error', title: 'No se pudo radicar', msg: res.error });
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cargar factura a la Bandeja (XML DIAN UBL 2.1 o manual)"
      subtitle={`${empresa.nombreCorto} · ${fmtPeriodo(periodo)} · Extrae NIT, CUFE, IVA, sugiere cuenta PUC y calcula retenciones`}
      width={720}
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          leerArchivo(e.dataTransfer.files?.[0]);
        }}
        style={{
          border: `1.5px dashed ${dragging ? 'var(--accent)' : 'var(--line-2)'}`,
          background: dragging ? 'var(--accent-soft)' : 'var(--surface-2)',
          borderRadius: 10,
          padding: '14px 16px',
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="entry-icon">
            <Icon name="file" size={17} />
          </span>
          <div>
            <strong style={{ display: 'block', fontSize: 12.5 }}>
              Arrastra aquí un XML de Factura Electrónica DIAN (UBL 2.1 / AttachedDocument)
            </strong>
            <small style={{ color: 'var(--muted)', fontSize: 11.5 }}>
              También puedes probar con una factura XML de ejemplo o llenar el formulario abajo.
            </small>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xml,text/xml,application/xml"
            style={{ display: 'none' }}
            onChange={(e) => leerArchivo(e.target.files?.[0])}
          />
          <Btn
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            Subir archivo .xml
          </Btn>
          <Btn
            type="button"
            variant="primary"
            size="sm"
            onClick={() => procesarXml(EJEMPLO_XML_DIAN_UBL, 'FE-EA-2026-4418.xml')}
          >
            Probar con XML DIAN de ejemplo
          </Btn>
        </div>
      </div>

      {xmlStatus && (
        <div
          className={`validacion ${xmlStatus.ok ? 'ok' : 'error'}`}
          style={{ borderRadius: 8, marginBottom: 12, borderTop: 'none' }}
        >
          <Icon name={xmlStatus.ok ? 'check' : 'alert'} size={14} />
          <span>
            <strong>{xmlStatus.archivo}:</strong> {xmlStatus.mensaje}
          </span>
        </div>
      )}

      <form onSubmit={(e) => void enviar(e)}>
        <div className="campos" style={{ marginBottom: 10 }}>
          <label className="campo">
            <small>Tipo documento</small>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as 'CC' | 'DS')}
              style={{ width: '100%', marginTop: 4 }}
            >
              <option value="CC">CC · Factura electrónica / compra</option>
              <option value="DS">DS · Documento soporte (no obligado)</option>
            </select>
          </label>
          <label className="campo">
            <small>Número de factura</small>
            <input
              type="text"
              required
              placeholder="Ej. FE-2026-1104"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          <label className="campo">
            <small>Fecha contable</small>
            <input
              type="date"
              required
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          <label className="campo">
            <small>Proveedor (catálogo de terceros)</small>
            <select
              value={terceroId}
              onChange={(e) => alCambiarTercero(e.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            >
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} ({p.documento})
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <small>Cuenta PUC de gasto sugerida</small>
            <select
              value={cuentaGasto}
              onChange={(e) => setCuentaGasto(e.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            >
              {CUENTAS_GASTO.map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  {c.codigo} · {c.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <small>Concepto / descripción</small>
            <input
              type="text"
              required
              placeholder="Ej. Mantenimiento preventivo de ascensores"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          <label className="campo">
            <small>Subtotal (antes de IVA)</small>
            <input
              type="number"
              min={0}
              step="any"
              required
              value={subtotal || ''}
              placeholder="2800000"
              onChange={(e) => setSubtotal(Number(e.target.value) || 0)}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          <label className="campo">
            <small>IVA</small>
            <input
              type="number"
              min={0}
              step="any"
              value={iva || ''}
              placeholder="532000"
              onChange={(e) => setIva(Number(e.target.value) || 0)}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          <label className="campo">
            <small>Otros impuestos (ICUI / INC)</small>
            <input
              type="number"
              min={0}
              step="any"
              value={otrosImpuestos || ''}
              placeholder="0"
              onChange={(e) => setOtrosImpuestos(Number(e.target.value) || 0)}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            marginBottom: 12,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={aplicarRetenciones}
            onChange={(e) => setAplicarRetenciones(e.target.checked)}
          />
          <span>
            Calcular retenciones automáticamente según perfil fiscal del proveedor (
            {proveedorSeleccionado
              ? `ReteFuente ${proveedorSeleccionado.retefuentePct}% · ReteICA ${proveedorSeleccionado.reteicaPct}% · ReteIVA ${proveedorSeleccionado.reteivaPct}%`
              : 'sin perfil'}
            )
          </span>
        </label>

        <div
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            borderRadius: 9,
            padding: '10px 12px',
            marginBottom: 14,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <small style={{ display: 'block', fontSize: 10, color: 'var(--muted)' }}>
                TOTAL FACTURA
              </small>
              <strong style={{ fontSize: 13 }}>{fmtMoney(totalFactura)}</strong>
            </div>
            <div>
              <small style={{ display: 'block', fontSize: 10, color: 'var(--muted)' }}>
                RETENCIONES
              </small>
              <strong style={{ fontSize: 13, color: 'var(--warn)' }}>
                {totalRetenciones > 0 ? `-${fmtMoney(totalRetenciones)}` : '$ 0'}
              </strong>
            </div>
            <div>
              <small style={{ display: 'block', fontSize: 10, color: 'var(--muted)' }}>
                NETO A PAGAR (220505)
              </small>
              <strong style={{ fontSize: 13, color: 'var(--accent-strong)' }}>
                {fmtMoney(netoPagar)}
              </strong>
            </div>
          </div>
          <Badge tone={totalFactura > 0 ? 'ok' : 'neutral'}>
            {preview.lineas.length} líneas · Partida doble cuadrada
          </Badge>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn type="submit" variant="primary" size="sm" disabled={guardando || subtotal <= 0}>
            {guardando ? 'Radicando…' : 'Radicar factura en Bandeja'}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
