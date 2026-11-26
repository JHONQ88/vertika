import { useMemo, useState } from 'react';
import type { Comprobante } from '../domain/types';
import { CUENTA_MAP } from '../domain/puc';
import { fmtFecha, fmtMoney, fmtPeriodo, hoyISO } from '../domain/format';
import { filasLibro, saldoCuenta } from '../domain/engine';
import { acciones, DATOS, esPeriodoBloqueado, tienePermiso, useAuth } from '../store';
import type { VistaProps } from '../ui-types';
import { Badge, Btn, Chip, Empty, Modal, ViewHeader } from '../components/ui';
import { DetalleComprobante } from '../components/DetalleComprobante';

export function Libro(props: VistaProps) {
  const { empresa, estado, filtros, setFiltros, modo, setModo, toast } = props;
  const auth = useAuth();
  const [detalle, setDetalle] = useState<Comprobante | null>(null);
  const puedeContabilizar = tienePermiso(auth.user.rol, 'contabilidad');
  const bloqueado = esPeriodoBloqueado(estado, estado.periodo);

  // Modal Pagar Proveedor (CE 1 clic desde Cuentas por Pagar 220505)
  const [pagoCxp, setPagoCxp] = useState<{
    terceroId: string;
    nombre: string;
    documento: string;
    saldo: number;
  } | null>(null);
  const [ceValor, setCeValor] = useState('');
  const [ceBanco, setCeBanco] = useState('111005');
  const [ceFecha, setCeFecha] = useState(hoyISO());
  const [ceRef, setCeRef] = useState('');
  const [ceGuardando, setCeGuardando] = useState(false);

  const filas = useMemo(
    () => filasLibro(estado.comprobantes, empresa.id, estado.periodo, filtros),
    [estado.comprobantes, empresa.id, estado.periodo, filtros],
  );

  const filasConSaldo = useMemo(() => {
    if (!filtros.cuenta) return filas.map((f) => ({ ...f, saldo: null as number | null }));
    const naturaleza = CUENTA_MAP[filtros.cuenta]?.naturaleza ?? 'D';
    let saldo = empresa.saldosIniciales[filtros.cuenta] ?? 0;
    for (const c of estado.comprobantes) {
      if (c.estado === 'ANULADO' || c.empresaId !== empresa.id || c.periodo >= estado.periodo) continue;
      for (const l of c.lineas) {
        if (l.cuenta !== filtros.cuenta) continue;
        saldo += naturaleza === 'D' ? l.debito - l.credito : l.credito - l.debito;
      }
    }
    const salida: Array<(typeof filas)[number] & { saldo: number | null }> = [];
    for (const f of filas) {
      saldo += naturaleza === 'D' ? f.debito - f.credito : f.credito - f.debito;
      salida.push({ ...f, saldo });
    }
    return salida;
  }, [filas, filtros.cuenta, empresa, estado.comprobantes, estado.periodo]);

  const resumen = useMemo(() => {
    if (modo !== 1) return [];
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

  const cxpProveedores = useMemo(() => {
    const map = new Map<
      string,
      { terceroId: string; nombre: string; documento: string; facturado: number; pagado: number }
    >();
    for (const c of estado.comprobantes) {
      if (c.estado === 'ANULADO' || c.empresaId !== empresa.id || c.periodo > estado.periodo) {
        continue;
      }
      for (const l of c.lineas) {
        if (l.cuenta !== '220505') continue;
        const key = l.terceroId || 'SIN_TERCERO';
        const ter = l.terceroId ? DATOS.terceros.find((t) => t.id === l.terceroId) : undefined;
        const cur = map.get(key) ?? {
          terceroId: l.terceroId ?? '',
          nombre: ter?.nombre ?? 'Proveedor sin asignar',
          documento: ter?.documento ?? '—',
          facturado: 0,
          pagado: 0,
        };
        cur.facturado += l.credito;
        cur.pagado += l.debito;
        map.set(key, cur);
      }
    }
    return Array.from(map.values())
      .map((r) => ({ ...r, saldo: r.facturado - r.pagado }))
      .sort((a, b) => b.saldo - a.saldo || a.nombre.localeCompare(b.nombre));
  }, [estado.comprobantes, empresa.id, estado.periodo]);

  const abrirPagoCxp = (row: (typeof cxpProveedores)[number]) => {
    setPagoCxp({
      terceroId: row.terceroId,
      nombre: row.nombre,
      documento: row.documento,
      saldo: row.saldo,
    });
    setCeValor(String(Math.max(0, Math.round(row.saldo))));
    setCeBanco('111005');
    setCeFecha(hoyISO());
    setCeRef('');
  };

  const asentarPagoCxp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pagoCxp) return;
    const valor = Math.round(Number(ceValor) || 0);
    if (valor <= 0) {
      toast({ tone: 'error', title: 'Valor inválido', msg: 'El valor a pagar debe ser mayor a $ 0.' });
      return;
    }
    setCeGuardando(true);
    try {
      const desc = `Pago proveedor ${pagoCxp.nombre}${ceRef.trim() ? ` · ${ceRef.trim()}` : ''}`;
      const res = await acciones.crearComprobanteManual({
        companyId: empresa.id,
        period: estado.periodo,
        entryType: 'CE',
        date: ceFecha || hoyISO(),
        description: desc,
        reference: ceRef.trim() || undefined,
        origin: 'CONTADOR_MANUAL',
        lines: [
          {
            id: 'l-1',
            cuenta: '220505',
            descripcion: `Cancelación CxP · ${pagoCxp.nombre}`,
            debito: valor,
            credito: 0,
            ...(pagoCxp.terceroId ? { terceroId: pagoCxp.terceroId } : {}),
          },
          {
            id: 'l-2',
            cuenta: ceBanco,
            descripcion: `Giro / transferencia a ${pagoCxp.nombre}`,
            debito: 0,
            credito: valor,
            ...(pagoCxp.terceroId ? { terceroId: pagoCxp.terceroId } : {}),
          },
        ],
      });
      if (res.ok) {
        toast({ tone: 'ok', title: 'Egreso (CE) asentado', msg: `${res.detalle} · ${fmtMoney(valor)}` });
        setPagoCxp(null);
      } else {
        toast({ tone: 'error', title: 'No se pudo asentar el egreso', msg: res.error });
      }
    } finally {
      setCeGuardando(false);
    }
  };

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
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <Btn size="sm" variant={modo === 0 ? 'primary' : 'outline'} onClick={() => setModo(0)}>
              Detalle
            </Btn>
            <Btn size="sm" variant={modo === 1 ? 'primary' : 'outline'} onClick={() => setModo(1)}>
              Por cuenta
            </Btn>
            <Btn size="sm" variant={modo === 2 ? 'primary' : 'outline'} onClick={() => setModo(2)}>
              Por pagar (220505)
            </Btn>
            <Btn size="sm" icon="download" onClick={exportar} disabled={filas.length === 0}>
              Exportar CSV
            </Btn>
          </div>
        }
      />

      {chips.length > 0 && modo !== 2 && (
        <div className="chips">
          {chips.map((c) => (
            <Chip key={c.label} label={c.label} onClear={c.clear} />
          ))}
          <button className="link" onClick={() => setFiltros({ cuenta: undefined, terceroId: undefined, unidadId: undefined })}>
            Limpiar filtros
          </button>
        </div>
      )}

      {modo === 2 ? (
        cxpProveedores.length === 0 ? (
          <Empty
            icon="wallet"
            title="Sin movimientos en Proveedores (220505)"
            text="Cuando causes facturas de proveedores aparecerá aquí el saldo exacto por tercero."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Proveedor / Tercero</th>
                  <th>NIT / Documento</th>
                  <th className="num">Facturado (Crédito)</th>
                  <th className="num">Pagado (Débito)</th>
                  <th className="num">Saldo pendiente</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {cxpProveedores.map((r) => (
                  <tr key={`${r.terceroId}-${r.documento}`}>
                    <td><strong>{r.nombre}</strong></td>
                    <td className="mono">{r.documento}</td>
                    <td className="num mono">{fmtMoney(r.facturado)}</td>
                    <td className="num mono">{fmtMoney(r.pagado)}</td>
                    <td className={`num mono ${r.saldo > 0 ? 'text-warn' : 'text-ok'}`}>
                      <strong>{fmtMoney(r.saldo)}</strong>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Btn
                          size="xs"
                          variant="outline"
                          onClick={() => {
                            setFiltros({
                              cuenta: '220505',
                              terceroId: r.terceroId || undefined,
                            });
                            setModo(0);
                          }}
                        >
                          Ver auxiliar
                        </Btn>
                        {r.saldo > 0 && puedeContabilizar && !bloqueado && (
                          <Btn size="xs" variant="primary" onClick={() => abrirPagoCxp(r)}>
                            Pagar (CE)
                          </Btn>
                        )}
                        {r.saldo <= 0 && <Badge tone="ok">Al día</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : filas.length === 0 ? (
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

      <Modal
        open={Boolean(pagoCxp)}
        onClose={() => setPagoCxp(null)}
        title="Pagar a proveedor (Comprobante de Egreso CE)"
        subtitle={pagoCxp ? `${pagoCxp.nombre} (${pagoCxp.documento}) · Saldo ${fmtMoney(pagoCxp.saldo)}` : ''}
        width={480}
      >
        {pagoCxp && (
          <form onSubmit={(e) => void asentarPagoCxp(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <label className="field">
                <span>Valor a pagar (COP)</span>
                <input
                  type="number"
                  min={1}
                  required
                  value={ceValor}
                  onChange={(e) => setCeValor(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Fecha del egreso</span>
                <input
                  type="date"
                  required
                  value={ceFecha}
                  onChange={(e) => setCeFecha(e.target.value)}
                />
              </label>
            </div>
            <label className="field">
              <span>Cuenta de salida del dinero</span>
              <select value={ceBanco} onChange={(e) => setCeBanco(e.target.value)}>
                <option value="111005">111005 · Bancos cuenta recaudadora</option>
                <option value="110505">110505 · Caja general</option>
              </select>
            </label>
            <label className="field">
              <span>Referencia / Factura / Transferencia</span>
              <input
                value={ceRef}
                onChange={(e) => setCeRef(e.target.value)}
                placeholder="Ej. Transferencia Bancolombia FE-151P"
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn type="button" variant="ghost" onClick={() => setPagoCxp(null)}>
                Cancelar
              </Btn>
              <Btn type="submit" variant="primary" disabled={ceGuardando}>
                {ceGuardando ? 'Asentando…' : 'Asentar Egreso (CE)'}
              </Btn>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
