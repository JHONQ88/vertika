import { useMemo, useState } from 'react';
import type { Comprobante, TipoComprobante } from '../domain/types';
import { fmtFecha, fmtMoney, fmtPeriodo } from '../domain/format';
import { DATOS } from '../store';
import type { VistaProps } from '../ui-types';
import { Badge, Btn, Empty, ViewHeader } from '../components/ui';
import { DetalleComprobante } from '../components/DetalleComprobante';

const TIPOS: Array<TipoComprobante | 'TODOS'> = ['TODOS', 'CC', 'RC', 'CE', 'NC', 'DS'];

export function Comprobantes(props: VistaProps) {
  const { empresa, estado, filtros, setFiltros, toast } = props;
  const [tipo, setTipo] = useState<TipoComprobante | 'TODOS'>('TODOS');
  const [q, setQ] = useState('');
  const [detalleSeleccionado, setDetalleSeleccionado] = useState<Comprobante | null>(null);

  const lista = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return estado.comprobantes
      .filter((c) => c.empresaId === empresa.id)
      .filter((c) => tipo === 'TODOS' || c.tipo === tipo)
      .filter((c) => {
        if (!needle) return true;
        return `${c.tipo}-${c.consecutivo} ${c.descripcion} ${c.referencia ?? ''} ${c.periodo}`
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => (a.fecha === b.fecha ? b.consecutivo - a.consecutivo : b.fecha.localeCompare(a.fecha)));
  }, [estado.comprobantes, empresa.id, tipo, q]);

  const detalle =
    detalleSeleccionado ??
    (filtros.comprobanteId ? estado.comprobantes.find((x) => x.id === filtros.comprobanteId) ?? null : null);

  const total = lista.reduce((s, c) => s + c.totalDebito, 0);

  const exportar = () => {
    const encabezado = ['Fecha', 'Periodo', 'Comprobante', 'Descripción', 'Origen', 'Referencia', 'Total'];
    const lineas = lista.map((c) => [c.fecha, c.periodo, `${c.tipo}-${c.consecutivo}`, c.descripcion, c.origen, c.referencia ?? '', c.totalDebito]);
    const csv = [encabezado, ...lineas]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comprobantes-${empresa.id}-${estado.periodo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ tone: 'ok', title: 'Comprobantes exportados', msg: `${lista.length} documentos` });
  };

  return (
    <div className="vista">
      <ViewHeader
        icon="file"
        title="Comprobantes"
        subtitle={`${empresa.nombreCorto} · ${lista.length} documentos · ${fmtMoney(total)}`}
        actions={
          <Btn size="sm" icon="download" onClick={exportar} disabled={lista.length === 0}>
            Exportar CSV
          </Btn>
        }
      />

      <div className="toolbar">
        <div className="tabs">
          {TIPOS.map((t) => (
            <button key={t} className={tipo === t ? 'is-active' : ''} onClick={() => setTipo(t)}>
              {t === 'TODOS' ? 'Todos' : t}
            </button>
          ))}
        </div>
        <div className="search">
          <input value={q} placeholder="Buscar por descripción, referencia o número…" onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {lista.length === 0 ? (
        <Empty icon="file" title="Sin comprobantes" text="No hay documentos para este filtro." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Comprobante</th>
                <th>Descripción</th>
                <th>Origen</th>
                <th>Referencia</th>
                <th className="num">Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} onClick={() => setDetalleSeleccionado(c)}>
                  <td>{fmtFecha(c.fecha)}</td>
                  <td>
                    <span className={`comp-tag comp-${c.tipo}`}>{c.tipo}</span>
                    <strong className="mono">{c.consecutivo}</strong>
                  </td>
                  <td className="celda-desc">{c.descripcion}</td>
                  <td>
                    <Badge tone="neutral">{c.origen.replace(/_/g, ' ')}</Badge>
                  </td>
                  <td className="mono">{c.referencia ?? '—'}</td>
                  <td className="num">{fmtMoney(c.totalDebito)}</td>
                  <td>
                    <Badge tone={c.estado === 'ASENTADO' ? 'ok' : 'error'}>{c.estado}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="pie-periodo">
        Mostrando comprobantes de todos los periodos · periodo activo {fmtPeriodo(estado.periodo)}
      </p>

      <DetalleComprobante
        comprobante={detalle}
        terceros={DATOS.terceros}
        unidades={DATOS.units.filter((u) => u.empresaId === empresa.id)}
        onClose={() => {
          setDetalleSeleccionado(null);
          if (filtros.comprobanteId) setFiltros({ comprobanteId: undefined });
        }}
      />
    </div>
  );
}
