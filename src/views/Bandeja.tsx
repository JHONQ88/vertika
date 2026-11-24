import { useState } from 'react';
import type { Linea, PreAsiento } from '../domain/types';
import { CUENTAS, CUENTA_MAP } from '../domain/puc';
import { fmtFecha, fmtMoney, fmtPeriodo } from '../domain/format';
import { esPeriodoBloqueado, tercerosDe, acciones, tienePermiso, useAuth } from '../store';
import { totalesLineas, validarAsiento } from '../domain/engine';
import type { VistaProps } from '../ui-types';
import { Badge, Btn, Empty, ProgressBar } from '../components/ui';
import { Icon } from '../components/Icon';
import { DocumentoView } from '../components/Documento';
import { CargarFacturaModal } from '../components/CargarFacturaModal';

interface BandejaProps extends VistaProps {
  seleccionado: string | null;
  setSeleccionado: (id: string | null) => void;
  onAprobar: (id: string) => void;
  onRechazar: (id: string) => void;
  onAcarrear: (pre: PreAsiento) => void;
}

let manualLineSeq = 0;

export function Bandeja({
  empresa,
  estado,
  toast,
  seleccionado,
  setSeleccionado,
  onAprobar,
  onRechazar,
  onAcarrear,
}: BandejaProps) {
  const [modalFactura, setModalFactura] = useState(false);
  const { user } = useAuth();
  const pendientes = estado.preAsientos.filter(
    (p) => p.empresaId === empresa.id && p.periodo === estado.periodo,
  );
  const pre = pendientes.find((p) => p.id === seleccionado) ?? pendientes[0];
  const bloqueado = esPeriodoBloqueado(estado, estado.periodo);
  const puedeCargar = tienePermiso(user.rol, 'maestros') && !bloqueado;
  const terceros = tercerosDe(estado);

  if (!pre) {
    return (
      <>
        <Empty
          icon="check"
          title="Bandeja limpia"
          text={
            pendientes.length === 0
              ? `No hay pre-asientos pendientes para ${fmtPeriodo(estado.periodo)}. Puedes cargar una factura XML DIAN o esperar a que los agentes de IA radiquen nuevos soportes.`
              : 'No hay pre-asientos para este periodo.'
          }
          action={
            puedeCargar ? (
              <Btn variant="primary" size="sm" icon="plus" onClick={() => setModalFactura(true)}>
                Cargar factura / XML
              </Btn>
            ) : undefined
          }
        />
        {modalFactura && (
          <CargarFacturaModal
            open={modalFactura}
            onClose={() => setModalFactura(false)}
            empresa={empresa}
            periodo={estado.periodo}
            terceros={terceros}
            onCreado={(id) => setSeleccionado(id)}
            toast={toast}
          />
        )}
      </>
    );
  }

  const valid = validarAsiento(pre.lineas);
  const totales = totalesLineas(pre.lineas);

  const actualizar = (id: string, patch: Partial<Linea>) => {
    if (bloqueado) return;
    acciones.cambiarLineasPreAsiento(
      pre.id,
      pre.lineas.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  };

  const agregarLinea = () => {
    if (bloqueado) return;
    acciones.cambiarLineasPreAsiento(pre.id, [
      ...pre.lineas,
      {
        id: `manual-${++manualLineSeq}`,
        cuenta: '513505',
        descripcion: '',
        debito: 0,
        credito: 0,
      },
    ]);
  };

  const quitarLinea = (id: string) => {
    if (bloqueado) return;
    acciones.cambiarLineasPreAsiento(
      pre.id,
      pre.lineas.filter((l) => l.id !== id),
    );
  };

  return (
    <div className="tray">
      <aside className="tray-list">
        <div className="tray-list-head">
          <div>
            <strong>Pre-asientos IA</strong>
            <span>{fmtPeriodo(estado.periodo)}</span>
          </div>
          <Badge tone={pendientes.length > 0 ? 'warn' : 'ok'}>{pendientes.length}</Badge>
        </div>
        {puedeCargar && (
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>
            <Btn
              variant="primary"
              size="sm"
              icon="plus"
              onClick={() => setModalFactura(true)}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              Cargar factura / XML DIAN
            </Btn>
          </div>
        )}

        {pendientes.map((p) => {
          const activo = p.id === pre.id;
          const prov = terceros.find((t) => t.id === p.terceroId);
          return (
            <button
              key={p.id}
              className={`tray-item ${activo ? 'is-active' : ''}`}
              onClick={() => setSeleccionado(p.id)}
            >
              <div className="tray-item-top">
                <span className={`comp-tag comp-${p.tipo}`}>{p.tipo}</span>
                <small>{p.documento.numero}</small>
                <span className={`confidence ${p.confianza >= 95 ? 'high' : 'mid'}`}>
                  {p.confianza.toFixed(1)}%
                </span>
              </div>
              <strong>{p.descripcion}</strong>
              <small>
                {prov?.nombre ?? 'Sin tercero'} · {fmtMoney(p.documento.total)}
              </small>
            </button>
          );
        })}
      </aside>

      <section className="tray-doc">
        <DocumentoView doc={pre.documento} />
      </section>

      <section className="tray-entry">
        <header className="entry-head">
          <div className="entry-title">
            <span className="entry-icon">
              <Icon name="bot" size={17} />
            </span>
            <div>
              <strong>{pre.agente.replace(/_/g, ' ')}</strong>
              <small>
                {pre.descripcion} · {fmtFecha(pre.fecha)}
              </small>
            </div>
          </div>
          <div className="entry-confidence">
            <small>Confianza</small>
            <strong>{pre.confianza.toFixed(1)}%</strong>
            <ProgressBar pct={pre.confianza} height={5} tone={pre.confianza >= 95 ? 'ok' : 'warn'} />
          </div>
        </header>

        {bloqueado && (
          <div className="entry-banner">
            <Icon name="lock" size={15} />
            <span>
              Periodo {fmtPeriodo(estado.periodo)} cerrado o sin abrir: solo lectura. Usa F4 para cambiar de periodo.
            </span>
          </div>
        )}

        <div className="entry-table-wrap">
          <table className="table entry-table">
            <thead>
              <tr>
                <th>Cuenta PUC</th>
                <th>Descripción</th>
                <th className="num">Débito</th>
                <th className="num">Crédito</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pre.lineas.map((l) => (
                <tr key={l.id}>
                  <td className="cell-cuenta">
                    <select
                      value={l.cuenta}
                      disabled={bloqueado}
                      onChange={(e) => actualizar(l.id, { cuenta: e.target.value })}
                    >
                      {CUENTAS.map((c) => (
                        <option key={c.codigo} value={c.codigo}>
                          {c.codigo} · {c.nombre}
                        </option>
                      ))}
                    </select>
                    <small>{CUENTA_MAP[l.cuenta]?.tipo}</small>
                  </td>
                  <td>
                    <input
                      value={l.descripcion}
                      disabled={bloqueado}
                      placeholder="Descripción del movimiento"
                      onChange={(e) => actualizar(l.id, { descripcion: e.target.value })}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      disabled={bloqueado}
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
                      disabled={bloqueado}
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
                      className="icon-btn"
                      disabled={bloqueado}
                      onClick={() => quitarLinea(l.id)}
                      title="Quitar línea"
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="add-line" disabled={bloqueado} onClick={agregarLinea}>
            <Icon name="plus" size={14} /> Agregar línea
          </button>
        </div>

        <div className={`validacion ${valid.ok ? 'ok' : 'error'}`}>
          {valid.ok ? (
            <span>
              <Icon name="check" size={14} /> Partida doble cuadrada · {pre.lineas.length} líneas
            </span>
          ) : (
            <ul>
              {valid.errores.map((e, i) => (
                <li key={i}>
                  <Icon name="alert" size={13} /> {e}
                </li>
              ))}
            </ul>
          )}
        </div>

        {pre.notas.length > 0 && (
          <ul className="entry-notas">
            {pre.notas.map((n, i) => (
              <li key={i}>
                <Icon name="spark" size={13} /> {n}
              </li>
            ))}
          </ul>
        )}

        <footer className="entry-foot">
          <div className="entry-totales">
            <div>
              <small>Débitos</small>
              <strong>{fmtMoney(totales.debito)}</strong>
            </div>
            <div>
              <small>Créditos</small>
              <strong>{fmtMoney(totales.credito)}</strong>
            </div>
            <div className={valid.ok ? 'ok' : 'error'}>
              <small>Diferencia</small>
              <strong>{fmtMoney(Math.abs(valid.diferencia))}</strong>
            </div>
          </div>
          <div className="entry-actions">
            <Btn variant="ghost" icon="x" onClick={() => onRechazar(pre.id)} disabled={bloqueado}>
              Devolver
            </Btn>
            <Btn variant="outline" icon="spark" onClick={() => onAcarrear(pre)} disabled={bloqueado}>
              F6 · Acarreo IA
            </Btn>
            <Btn
              variant="primary"
              icon="check"
              onClick={() => onAprobar(pre.id)}
              disabled={!valid.ok || bloqueado}
              title={bloqueado ? 'Periodo cerrado' : valid.ok ? 'Asentar (F10)' : 'El asiento no cuadra'}
            >
              F10 · Asentar
            </Btn>
          </div>
        </footer>
      </section>
      {modalFactura && (
        <CargarFacturaModal
          open={modalFactura}
          onClose={() => setModalFactura(false)}
          empresa={empresa}
          periodo={estado.periodo}
          terceros={terceros}
          onCreado={(id) => setSeleccionado(id)}
          toast={toast}
        />
      )}
    </div>
  );
}
