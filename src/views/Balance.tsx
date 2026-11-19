import { Fragment, useMemo } from 'react';
import { fmtMoney, fmtPeriodo } from '../domain/format';
import { balancePrueba } from '../domain/engine';
import {
  descargarArchivo,
  estadoResultados,
  estadoSituacionFinanciera,
  generarEstadosFinancierosHTML,
} from '../domain/reports';
import { TIPOS_CUENTA } from '../domain/puc';
import type { VistaProps } from '../ui-types';
import { Badge, Btn, Card, Empty, Stat, ViewHeader } from '../components/ui';
import { Icon } from '../components/Icon';

export function Balance(props: VistaProps) {
  const { empresa, estado, modo, setModo, toast } = props;
  const balance = useMemo(
    () => balancePrueba(estado.comprobantes, empresa, estado.periodo),
    [estado.comprobantes, empresa, estado.periodo],
  );
  const esf = useMemo(
    () => estadoSituacionFinanciera(estado.comprobantes, empresa, estado.periodo),
    [estado.comprobantes, empresa, estado.periodo],
  );
  const er = useMemo(
    () => estadoResultados(estado.comprobantes, empresa, estado.periodo),
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
    descargarArchivo(`balance-prueba-${empresa.id}-${estado.periodo}.csv`, `﻿${csv}`, 'text/csv;charset=utf-8');
    toast({ tone: 'ok', title: 'Balance exportado', msg: `${balance.filas.length} cuentas` });
  };

  const descargarEEFF = () => {
    const html = generarEstadosFinancierosHTML(empresa, estado.periodo, esf, er);
    descargarArchivo(`estados-financieros-${empresa.id}-${estado.periodo}.html`, html, 'text/html;charset=utf-8');
    toast({ tone: 'ok', title: 'Estados financieros ESAL descargados', msg: fmtPeriodo(estado.periodo) });
  };

  const modoLabel =
    modo === 0 ? 'Vista: saldos' : modo === 1 ? 'Vista: movimientos' : 'Vista: estados financieros';

  return (
    <div className="vista">
      <ViewHeader
        icon="scale"
        title={modo === 2 ? 'Estados financieros ESAL' : 'Balance de prueba'}
        subtitle={`${empresa.nombreCorto} · ${fmtPeriodo(estado.periodo)}`}
        actions={
          <>
            <Badge tone={balance.cuadra && esf.cuadra ? 'ok' : 'error'}>
              {balance.cuadra && esf.cuadra ? 'Cuadra' : 'Descuadrado'}
            </Badge>
            <Btn size="sm" variant="subtle" onClick={() => setModo((modo + 1) % 3)}>
              {modoLabel} (F11)
            </Btn>
            <Btn size="sm" icon="file" onClick={descargarEEFF} disabled={balance.filas.length === 0}>
              Descargar EEFF
            </Btn>
            <Btn size="sm" icon="download" onClick={exportar} disabled={balance.filas.length === 0}>
              Exportar CSV
            </Btn>
          </>
        }
      />

      {balance.filas.length === 0 ? (
        <Empty icon="scale" title="Sin movimientos" text="Este periodo no tiene contabilidad generada." />
      ) : modo === 2 ? (
        <>
          <div className="stat-grid">
            <Stat label="Total Activo" value={fmtMoney(esf.totalActivos)} icon="wallet" />
            <Stat label="Total Pasivo" value={fmtMoney(esf.totalPasivos)} icon="clock" />
            <Stat label="Patrimonio + Excedente" value={fmtMoney(esf.totalPatrimonio)} tone="accent" icon="scale" />
            <Stat
              label="Excedente acumulado"
              value={fmtMoney(er.excedente)}
              tone={er.excedente >= 0 ? 'ok' : 'warn'}
              icon="pie"
            />
          </div>

          <div className="dos-col">
            <Card
              title="Estado de Situación Financiera"
              subtitle={`Ecuación patrimonial: ${esf.cuadra ? 'Activo = Pasivo + Patrimonio ✔' : 'Descuadre'}`}
              padded={false}
            >
              <table className="table table-tight">
                <thead>
                  <tr>
                    <th>Cuenta</th>
                    <th>Concepto</th>
                    <th className="num">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="group-row">
                    <td colSpan={2}>ACTIVO</td>
                    <td className="num">{fmtMoney(esf.totalActivos)}</td>
                  </tr>
                  {esf.activos.map((r) => (
                    <tr key={r.codigo}>
                      <td><span className="cuenta-cod">{r.codigo}</span></td>
                      <td>{r.nombre}{r.contra ? ' (CR)' : ''}</td>
                      <td className="num">{fmtMoney(r.contra ? -r.saldo : r.saldo)}</td>
                    </tr>
                  ))}
                  <tr className="group-row">
                    <td colSpan={2}>PASIVO</td>
                    <td className="num">{fmtMoney(esf.totalPasivos)}</td>
                  </tr>
                  {esf.pasivos.map((r) => (
                    <tr key={r.codigo}>
                      <td><span className="cuenta-cod">{r.codigo}</span></td>
                      <td>{r.nombre}</td>
                      <td className="num">{fmtMoney(r.contra ? -r.saldo : r.saldo)}</td>
                    </tr>
                  ))}
                  <tr className="group-row">
                    <td colSpan={2}>PATRIMONIO</td>
                    <td className="num">{fmtMoney(esf.totalPatrimonio)}</td>
                  </tr>
                  {esf.patrimonio.map((r) => (
                    <tr key={r.codigo}>
                      <td><span className="cuenta-cod">{r.codigo}</span></td>
                      <td>{r.nombre}</td>
                      <td className="num">{fmtMoney(r.contra ? -r.saldo : r.saldo)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td><span className="cuenta-cod">360505</span></td>
                    <td>Excedente / (Déficit) del ejercicio</td>
                    <td className="num">{fmtMoney(esf.excedenteEjercicio)}</td>
                  </tr>
                </tbody>
              </table>
            </Card>

            <Card
              title="Estado de Resultados Integral"
              subtitle={`Acumulado año ${estado.periodo.split('-')[0]} · OT-15 CTCP`}
              padded={false}
            >
              <table className="table table-tight">
                <thead>
                  <tr>
                    <th>Cuenta</th>
                    <th>Concepto</th>
                    <th className="num">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="group-row">
                    <td colSpan={2}>INGRESOS</td>
                    <td className="num">{fmtMoney(er.totalIngresos)}</td>
                  </tr>
                  {er.ingresos.map((r) => (
                    <tr key={r.codigo}>
                      <td><span className="cuenta-cod">{r.codigo}</span></td>
                      <td>{r.nombre}{r.contra ? ' (CR)' : ''}</td>
                      <td className="num">{fmtMoney(r.contra ? -r.saldo : r.saldo)}</td>
                    </tr>
                  ))}
                  <tr className="group-row">
                    <td colSpan={2}>GASTOS</td>
                    <td className="num">{fmtMoney(er.totalGastos)}</td>
                  </tr>
                  {er.gastos.map((r) => (
                    <tr key={r.codigo}>
                      <td><span className="cuenta-cod">{r.codigo}</span></td>
                      <td>{r.nombre}</td>
                      <td className="num">{fmtMoney(r.contra ? -r.saldo : r.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Excedente / (Déficit) del periodo</td>
                    <td className="num">{fmtMoney(er.excedente)}</td>
                  </tr>
                </tfoot>
              </table>
            </Card>
          </div>
        </>
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
