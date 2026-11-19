import { useState } from 'react';
import type { Comprobante, Tercero, Unidad } from '../domain/types';
import { CUENTA_MAP } from '../domain/puc';
import { fmtFecha, fmtMoney, fmtPeriodo } from '../domain/format';
import { Badge, Btn } from './ui';
import { Icon } from './Icon';

export function DetalleComprobante({
  comprobante,
  terceros,
  unidades,
  puedeAnular = false,
  onAnular,
  onClose,
}: {
  comprobante: Comprobante | null;
  terceros: Tercero[];
  unidades: Unidad[];
  puedeAnular?: boolean;
  onAnular?: (id: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [anulando, setAnulando] = useState(false);

  if (!comprobante) return null;
  const c = comprobante;
  const tercero = (id?: string) => terceros.find((t) => t.id === id);
  const unidad = (id?: string) => unidades.find((u) => u.id === id);
  const cuadra = Math.abs(c.totalDebito - c.totalCredito) < 0.01;
  const confirmando = confirmId === c.id;

  const ejecutarAnulacion = async () => {
    if (!onAnular || !puedeAnular || anulando) return;
    if (!confirmando) {
      setConfirmId(c.id);
      return;
    }
    setAnulando(true);
    try {
      await onAnular(c.id);
      setConfirmId(null);
    } finally {
      setAnulando(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer">
        <header className="drawer-head">
          <div>
            <div className="drawer-title">
              <span className={`comp-tag comp-${c.tipo}`}>{c.tipo}</span>
              <h2>
                {c.tipo}-{c.consecutivo}
              </h2>
              <Badge tone={c.estado === 'ANULADO' ? 'error' : cuadra ? 'ok' : 'error'}>
                {c.estado === 'ANULADO' ? 'Anulado' : cuadra ? 'Cuadra' : 'Descuadrado'}
              </Badge>
            </div>
            <p>{c.descripcion}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="drawer-meta">
          <div>
            <small>Fecha</small>
            <strong>{fmtFecha(c.fecha)}</strong>
          </div>
          <div>
            <small>Periodo</small>
            <strong>{fmtPeriodo(c.periodo)}</strong>
          </div>
          <div>
            <small>Origen</small>
            <strong>{c.origen.replace(/_/g, ' ')}</strong>
          </div>
          <div>
            <small>Referencia</small>
            <strong>{c.referencia ?? '—'}</strong>
          </div>
          <div>
            <small>Hash</small>
            <strong className="mono" title={c.hash}>
              #{c.hash.slice(0, 12)}
            </strong>
          </div>
          <div>
            <small>Creado por</small>
            <strong>{c.creadoPor}</strong>
          </div>
        </div>

        <div className="drawer-body">
          <table className="table table-tight">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Tercero / unidad</th>
                <th>Descripción</th>
                <th className="num">Débito</th>
                <th className="num">Crédito</th>
              </tr>
            </thead>
            <tbody>
              {c.lineas.map((l) => (
                <tr key={l.id}>
                  <td>
                    <span className="cuenta-cod">{l.cuenta}</span>
                    <span className="cuenta-nom">{CUENTA_MAP[l.cuenta]?.nombre}</span>
                  </td>
                  <td className="celda-tercero">
                    {tercero(l.terceroId) && <span>{tercero(l.terceroId)!.nombre}</span>}
                    {unidad(l.unidadId) && (
                      <small>
                        {unidad(l.unidadId)!.torre} {unidad(l.unidadId)!.numero}
                      </small>
                    )}
                  </td>
                  <td className="celda-desc">{l.descripcion}</td>
                  <td className="num">{l.debito > 0 ? fmtMoney(l.debito) : '—'}</td>
                  <td className="num">{l.credito > 0 ? fmtMoney(l.credito) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Totales</td>
                <td className="num">{fmtMoney(c.totalDebito)}</td>
                <td className="num">{fmtMoney(c.totalCredito)}</td>
              </tr>
            </tfoot>
          </table>

          {c.estado === 'ASENTADO' && onAnular && (
            <div className="cierre-acciones" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
              {confirmando && (
                <Btn size="sm" variant="ghost" onClick={() => setConfirmId(null)} disabled={anulando}>
                  Cancelar
                </Btn>
              )}
              <Btn
                size="sm"
                variant={confirmando ? 'danger' : 'outline'}
                icon="x"
                disabled={!puedeAnular || anulando}
                title={puedeAnular ? 'Genera nota contable NC de reverso' : 'Periodo cerrado: solo lectura'}
                onClick={() => void ejecutarAnulacion()}
              >
                {anulando
                  ? 'Anulando…'
                  : confirmando
                    ? 'Confirmar anulación (genera NC)'
                    : 'Anular comprobante'}
              </Btn>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
