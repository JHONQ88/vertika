import { Fragment, useMemo } from 'react';
import { fmtMoney, fmtPeriodo } from '../domain/format';
import { balancePrueba } from '../domain/engine';
import { TIPOS_CUENTA } from '../domain/puc';
import type { VistaProps } from '../ui-types';
import { Badge, Btn, Empty, ViewHeader } from '../components/ui';
import { Icon } from '../components/Icon';

export function Balance(props: VistaProps) {
  const { empresa, estado, modo, toast } = props;
  const balance = useMemo(
    () => balancePrueba(estado.comprobantes, empresa, estado.periodo),
    [estado.comprobantes, empresa, estado.periodo],
  );

  const grupos = useMemo(
    () =>
      TIPOS_CUENTA.map((tipo) => {
        const filas = balance.filas.filter((f) => f.tipo === tipo);
        const natTipo = tipo === 'ACTIVO' || tipo === 'GASTO' ? 'D' : 'C';
        const total = filas.reduce(
          (s, f) => s + (f.naturaleza === natTipo ? f.saldoActual : -f.saldoActual),
          0,
        );
        return { tipo, filas, total };
      }).filter((g) => g.filas.length > 0),
    [balance],
  );

  const exportar = () => {
    const encabezado = ['Cuenta', 'Nombre', 'Tipo', 'Saldo anterior', 'Débitos', 'Créditos', 'Saldo actual'];
    const lineas = balance.filas.map((f) => [f.codigo, f.nombre, f.tipo, f.saldoAnterior, f.debitos, f.creditos, f.saldoActual]);
    const csv = [encabezado, ...lineas]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `balance-prueba-${empresa.id}-${estado.periodo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ tone: 'ok', title: 'Balance exportado', msg: `${balance.filas.length} cuentas` });
  };

  return (
    <div className="vista">
      <ViewHeader
        icon="scale"
        title="Balance de prueba"
        subtitle={`${empresa.nombreCorto} · ${fmtPeriodo(estado.periodo)}`}
        actions={
          <>
            <Badge tone={balance.cuadra ? 'ok' : 'error'}>
              {balance.cuadra ? 'Cuadra' : 'Descuadrado'}
            </Badge>
            <Badge tone="neutral">{modo === 0 ? 'Vista: saldos' : 'Vista: movimientos'}</Badge>
            <Btn size="sm" icon="download" onClick={exportar} disabled={balance.filas.length === 0}>
              Exportar CSV
            </Btn>
          </>
        }
      />

      {balance.filas.length === 0 ? (
        <Empty icon="scale" title="Sin movimientos" text="Este periodo no tiene contabilidad generada." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Nombre</th>
                {modo === 0 && <th className="num">Saldo anterior</th>}
                <th className="num">Débitos</th>
                <th className="num">Créditos</th>
                {modo === 0 && <th className="num">Saldo actual</th>}
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <Fragment key={g.tipo}>
                  <tr className="group-row">
                    {modo === 0 ? (
                      <>
                        <td colSpan={5}>{g.tipo}</td>
                        <td className="num">{fmtMoney(g.total)}</td>
                      </>
                    ) : (
                      <>
                        <td colSpan={3}>{g.tipo}</td>
                        <td className="num">{fmtMoney(g.total)}</td>
                      </>
                    )}
                  </tr>
                  {g.filas.map((f) => (
                    <tr key={f.codigo}>
                      <td>
                        <span className="cuenta-cod">{f.codigo}</span>
                      </td>
                      <td>{f.nombre}</td>
                      {modo === 0 && <td className="num">{fmtMoney(f.saldoAnterior)}</td>}
                      <td className="num">{f.debitos > 0 ? fmtMoney(f.debitos) : '—'}</td>
                      <td className="num">{f.creditos > 0 ? fmtMoney(f.creditos) : '—'}</td>
                      {modo === 0 && <td className="num">{fmtMoney(f.saldoActual)}</td>}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={modo === 0 ? 3 : 2}>Totales</td>
                {modo === 0 && <td className="num">{fmtMoney(balance.totalSaldoAnterior)}</td>}
                <td className="num">{fmtMoney(balance.totalDebitos)}</td>
                <td className="num">{fmtMoney(balance.totalCreditos)}</td>
                {modo === 0 && <td className="num">{fmtMoney(balance.totalSaldoActual)}</td>}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="balance-resumen">
        <div>
          <Icon name="check" size={15} className="text-ok" />
          <span>Sumas débito {fmtMoney(balance.totalDebitos)} = sumas crédito {fmtMoney(balance.totalCreditos)}</span>
        </div>
        <div>
          <Icon name="lock" size={15} className="text-muted" />
          <span>Solo lectura en periodos cerrados</span>
        </div>
      </div>
    </div>
  );
}
