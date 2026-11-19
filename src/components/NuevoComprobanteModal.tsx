import { useState } from 'react';
import type { Copropiedad, Linea, Rubro, Tercero, TipoComprobante, Unidad } from '../domain/types';
import { CUENTAS } from '../domain/puc';
import { validarAsiento } from '../domain/engine';
import { fmtMoney, fmtPeriodo } from '../domain/format';
import { acciones } from '../store';
import type { ToastData } from '../ui-types';
import { Badge, Btn, Modal } from './ui';
import { Icon } from './Icon';

let manualEntryLineSeq = 0;

function nuevaLinea(cuenta = '519510'): Linea {
  return {
    id: `mc-${++manualEntryLineSeq}`,
    cuenta,
    descripcion: '',
    debito: 0,
    credito: 0,
  };
}

const TIPOS: TipoComprobante[] = ['CC', 'RC', 'CE', 'NC', 'DS'];

export function NuevoComprobanteModal({
  open,
  empresa,
  periodo,
  terceros,
  unidades,
  rubros,
  onClose,
  toast,
}: {
  open: boolean;
  empresa: Copropiedad;
  periodo: string;
  terceros: Tercero[];
  unidades: Unidad[];
  rubros: Rubro[];
  onClose: () => void;
  toast: (t: ToastData) => void;
}) {
  const [tipo, setTipo] = useState<TipoComprobante>('CC');
  const [fecha, setFecha] = useState(`${periodo}-15`);
  const [descripcion, setDescripcion] = useState('');
  const [referencia, setReferencia] = useState('');
  const [lineas, setLineas] = useState<Linea[]>(() => [
    nuevaLinea('519510'),
    nuevaLinea('220505'),
  ]);
  const [guardando, setGuardando] = useState(false);

  const valid = validarAsiento(lineas);

  const actualizar = (id: string, patch: Partial<Linea>) => {
    setLineas((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid.ok || !descripcion.trim()) return;
    setGuardando(true);
    try {
      const res = await acciones.crearComprobanteManual({
        companyId: empresa.id,
        period: periodo,
        entryType: tipo,
        date: fecha,
        description: descripcion.trim(),
        reference: referencia.trim() || undefined,
        origin: 'CONTADOR_MANUAL',
        lines: lineas,
      });
      if (res.ok) {
        toast({
          tone: 'ok',
          title: 'Comprobante asentado',
          msg: `${res.detalle} · ${fmtPeriodo(periodo)}`,
        });
        setDescripcion('');
        setReferencia('');
        setLineas([nuevaLinea('519510'), nuevaLinea('220505')]);
        onClose();
      } else {
        toast({ tone: 'error', title: 'No se pudo asentar', msg: res.error });
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo comprobante contable"
      subtitle={`${empresa.nombreCorto} · ${fmtPeriodo(periodo)} · Validación determinista de partida doble`}
      width={880}
    >
      <form onSubmit={(e) => void enviar(e)}>
        <div className="campos" style={{ gridTemplateColumns: '120px 150px 1fr 180px', marginBottom: 12 }}>
          <label className="campo">
            <small>Tipo</small>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoComprobante)}
              style={{ width: '100%', marginTop: 4 }}
            >
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <small>Fecha</small>
            <input
              type="date"
              required
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          <label className="campo">
            <small>Descripción</small>
            <input
              required
              value={descripcion}
              placeholder="Ej. Pago servicio de mantenimiento"
              onChange={(e) => setDescripcion(e.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          <label className="campo">
            <small>Referencia</small>
            <input
              value={referencia}
              placeholder="Opcional (factura/recibo)"
              onChange={(e) => setReferencia(e.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
        </div>

        <div className="entry-table-wrap" style={{ marginBottom: 12 }}>
          <table className="table entry-table">
            <thead>
              <tr>
                <th>Cuenta PUC</th>
                <th>Tercero / Unidad / Rubro</th>
                <th>Descripción</th>
                <th className="num">Débito</th>
                <th className="num">Crédito</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => (
                <tr key={l.id}>
                  <td className="cell-cuenta">
                    <select value={l.cuenta} onChange={(e) => actualizar(l.id, { cuenta: e.target.value })}>
                      {CUENTAS.map((c) => (
                        <option key={c.codigo} value={c.codigo}>
                          {c.codigo} · {c.nombre}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div style={{ display: 'grid', gap: 4 }}>
                      <select
                        value={l.terceroId ?? ''}
                        onChange={(e) => actualizar(l.id, { terceroId: e.target.value || undefined })}
                      >
                        <option value="">Sin tercero</option>
                        {terceros.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.nombre}
                          </option>
                        ))}
                      </select>
                      <select
                        value={l.unidadId ?? ''}
                        onChange={(e) => actualizar(l.id, { unidadId: e.target.value || undefined })}
                      >
                        <option value="">Sin unidad</option>
                        {unidades.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.torre} {u.numero}
                          </option>
                        ))}
                      </select>
                      <select
                        value={l.rubroId ?? ''}
                        onChange={(e) => actualizar(l.id, { rubroId: e.target.value || undefined })}
                      >
                        <option value="">Sin rubro</option>
                        {rubros.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.key} · {r.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td>
                    <input
                      value={l.descripcion}
                      placeholder="Concepto de línea"
                      onChange={(e) => actualizar(l.id, { descripcion: e.target.value })}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      value={l.debito || ''}
                      placeholder="0"
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        actualizar(l.id, { debito: Number.isNaN(v) ? 0 : v });
                      }}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      value={l.credito || ''}
                      placeholder="0"
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        actualizar(l.id, { credito: Number.isNaN(v) ? 0 : v });
                      }}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setLineas((prev) => prev.filter((x) => x.id !== l.id))}
                      disabled={lineas.length <= 2}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="add-line"
            onClick={() => setLineas((prev) => [...prev, nuevaLinea('513505')])}
          >
            <Icon name="plus" size={14} /> Agregar línea
          </button>
        </div>

        <div className={`validacion ${valid.ok ? 'ok' : 'error'}`} style={{ marginBottom: 12 }}>
          {valid.ok ? (
            <span>
              <Icon name="check" size={14} /> Partida doble cuadrada · Débito {fmtMoney(valid.totalDebito)} = Crédito{' '}
              {fmtMoney(valid.totalCredito)}
            </span>
          ) : (
            <span>
              <Icon name="alert" size={14} /> {valid.errores[0]}
            </span>
          )}
        </div>

        <div className="cierre-acciones" style={{ justifyContent: 'space-between' }}>
          <Badge tone="neutral">{lineas.length} líneas</Badge>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Btn>
            <Btn type="submit" variant="primary" icon="check" disabled={!valid.ok || !descripcion.trim() || guardando}>
              {guardando ? 'Asentando…' : 'Asentar comprobante'}
            </Btn>
          </div>
        </div>
      </form>
    </Modal>
  );
}
