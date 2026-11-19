import { useMemo, useState } from 'react';
import type { Comprobante } from '../domain/types';
import { CUENTA_MAP } from '../domain/puc';
import { fmtFecha, fmtMoney, fmtPeriodo } from '../domain/format';
import { filasLibro, saldoCuenta } from '../domain/engine';
import { DATOS } from '../store';
import type { VistaProps } from '../ui-types';
import { Badge, Btn, Chip, Empty, ViewHeader } from '../components/ui';
import { DetalleComprobante } from '../components/DetalleComprobante';

export function Libro(props: VistaProps) {
  const { empresa, estado, filtros, setFiltros, modo, toast } = props;
  const [detalle, setDetalle] = useState<Comprobante | null>(null);

  const filas = useMemo(
    () => filasLibro(estado.comprobantes, empresa.id, estado.periodo, filtros),
    [estado.comprobantes, empresa.id, estado.periodo, filtros],
  );

  const filasConSaldo = useMemo(() => {
    if (!filtros.cuenta) return filas.map((f) => ({ ...f, saldo: null as number | null }));
    const naturaleza = CUENTA_MAP[filtros.cuenta]?.naturaleza ?? 'D';
    let saldo = empresa.saldosIniciales[filtros.cuenta] ?? 0;
    for (const c of estado.comprobantes) {
      if (c.empresaId !== empresa.id || c.periodo >= estado.periodo) continue;
      for (const l of c.lineas) {
        if (l.cuenta !== filtros.cuenta) continue;
        saldo += naturaleza === 'D' ? l.debito - l.credito : l.credito - l.debito;
      }
    }
    return filas.map((f) => {
      saldo += naturaleza === 'D' ? f.debito - f.credito : f.credito - f.debito;
      return { ...f, saldo };
    });
  }, [filas, filtros.cuenta, empresa, estado.comprobantes, estado.periodo]);

  const resumen = useMemo(() => {
    if (modo === 0) return [];
    const mapa = new Map<string, { cuenta: string; nombre: string; debitos: number; creditos: number }>();
    for (const f of filas) {
      const actual = mapa.get(f.cuenta) ?? {
        cuenta: f.cuenta,
        nombre: f.nombreCuenta,
        debitos: 0,
        creditos: 0,
      };
      actual.debitos += f.debito;
      actual.creditos += f.credito;
      mapa.set(f.cuenta, actual);
    }
    return Array.from(mapa.values())
      .map((r) => ({
        ...r,
        saldo: saldoCuenta(estado.comprobantes, empresa, r.cuenta, estado.periodo),
      }))
      .sort((a, b) => a.cuenta.localeCompare(b.cuenta));
  }, [modo, filas, estado.comprobantes, empresa, estado.periodo]);

  const exportar = () => {
    const encabezado = ['Fecha', 'Periodo', 'Comprobante', 'Cuenta', 'Descripción', 'Tercero', 'Unidad', 'Débito', 'Crédito'];
    const lineas = filas.map((f) => [
      f.fecha,
      f.periodo,
      `${f.tipo}-${f.consecutivo}`,
      f.cuenta,
      f.descripcion,
      DATOS.terceros.find((t) => t.id === f.terceroId)?.nombre ?? '',
      DATOS.units.find((u) => u.id === f.unidadId)
        ? `${DATOS.units.find((u) => u.id === f.unidadId)!.torre} ${DATOS.units.find((u) => u.id === f.unidadId)!.numero}`
        : '',
      f.debito,
      f.credito,
    ]);
    const csv = [encabezado, ...lineas]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `libro-auxiliar-${empresa.id}-${estado.periodo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ tone: 'ok', title: 'Libro exportado', msg: `${filas.length} líneas · ${empresa.nombreCorto}` });
  };

  const chips: Array<{ label: string; clear: () => void }> = [];
  if (filtros.cuenta) {
    chips.push({
      label: `Cuenta ${filtros.cuenta} · ${CUENTA_MAP[filtros.cuenta]?.nombre ?? ''}`,
      clear: () => setFiltros({ cuenta: undefined }),
    });
  }
  if (filtros.terceroId) {
    const t = DATOS.terceros.find((x) => x.id === filtros.terceroId);
    chips.push({ label: `Tercero ${t?.nombre ?? ''}`, clear: () => setFiltros({ terceroId: undefined }) });
  }
  if (filtros.unidadId) {
    const u = DATOS.units.find((x) => x.id === filtros.unidadId);
    chips.push({
      label: `Unidad ${u ? `${u.torre} ${u.numero}` : ''}`,
      clear: () => setFiltros({ unidadId: undefined }),
    });
  }

  return (
    <div className="vista">
      <ViewHeader
        icon="book"
        title="Libro auxiliar"
        subtitle={`${empresa.nombreCorto} · ${fmtPeriodo(estado.periodo)} · ${filas.length} movimientos`}
        actions={
          <>
            <Badge tone={modo === 0 ? 'info' : 'neutral'}>{modo === 0 ? 'Vista: detalle' : 'Vista: por cuenta'}</Badge>
            <Btn size="sm" icon="download" onClick={exportar} disabled={filas.length === 0}>
              Exportar CSV
            </Btn>
          </>
        }
      />

      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <Chip key={c.label} label={c.label} onClear={c.clear} />
          ))}
          <button className="link" onClick={() => setFiltros({ cuenta: undefined, terceroId: undefined, unidadId: undefined })}>
            Limpiar filtros
          </button>
        </div>
      )}

      {filas.length === 0 ? (
        <Empty icon="book" title="Sin movimientos" text="Prueba con otro periodo (F4) o limpia los filtros." />
      ) : modo === 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Comp.</th>
                <th>Cuenta</th>
                <th>Tercero</th>
                <th>Unidad</th>
                <th>Descripción</th>
                <th className="num">Débito</th>
                <th className="num">Crédito</th>
                <th className="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {filasConSaldo.map((f) => {
                const tercero = DATOS.terceros.find((t) => t.id === f.terceroId);
                const unidad = DATOS.units.find((u) => u.id === f.unidadId);
                return (
                  <tr key={`${f.comprobante.id}-${f.linea.id}`} onClick={() => setDetalle(f.comprobante)}>
                    <td>{fmtFecha(f.fecha)}</td>
                    <td>
                      <span className={`comp-tag comp-${f.tipo}`}>{f.tipo}</span>
                      <small className="mono">{f.consecutivo}</small>
                    </td>
                    <td>
                      <span className="cuenta-cod">{f.cuenta}</span>
                      <span className="cuenta-nom">{f.nombreCuenta}</span>
                    </td>
                    <td className="celda-tercero">
                      {tercero ? (
                        <>
                          <span>{tercero.nombre}</span>
                          <small>{tercero.documento}</small>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="celda-unidad">
                      {unidad ? `${unidad.torre} ${unidad.numero}` : '—'}
                    </td>
                    <td className="celda-desc">{f.descripcion}</td>
                    <td className="num">{f.debito > 0 ? fmtMoney(f.debito) : '—'}</td>
                    <td className="num">{f.credito > 0 ? fmtMoney(f.credito) : '—'}</td>
                    <td className="num">{f.saldo === null ? '—' : fmtMoney(f.saldo)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Nombre</th>
                <th className="num">Débitos</th>
                <th className="num">Créditos</th>
                <th className="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {resumen.map((r) => (
                <tr key={r.cuenta}>
                  <td>
                    <span className="cuenta-cod">{r.cuenta}</span>
                  </td>
                  <td>{r.nombre}</td>
                  <td className="num">{r.debitos > 0 ? fmtMoney(r.debitos) : '—'}</td>
                  <td className="num">{r.creditos > 0 ? fmtMoney(r.creditos) : '—'}</td>
                  <td className="num">{fmtMoney(r.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DetalleComprobante
        comprobante={detalle}
        terceros={DATOS.terceros}
        unidades={DATOS.units.filter((u) => u.empresaId === empresa.id)}
        onClose={() => setDetalle(null)}
      />
    </div>
  );
}
