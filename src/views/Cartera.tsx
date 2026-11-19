import { useMemo, useState } from 'react';
import { cartera } from '../domain/engine';
import { cuotaMensual } from '../domain/seed';
import { descargarArchivo, generarPazYSalvoHTML } from '../domain/reports';
import { fmtCoef, fmtMoney, fmtPeriodo } from '../domain/format';
import { acciones, DATOS, esPeriodoBloqueado, tienePermiso, useAuth } from '../store';
import type { VistaProps } from '../ui-types';
import { Badge, Btn, Chip, Empty, Modal, Stat, Toggle, ViewHeader } from '../components/ui';

const norm = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function Cartera(props: VistaProps) {
  const { empresa, estado, filtros, setFiltros, modo, toast } = props;
  const auth = useAuth();
  const [q, setQ] = useState('');
  const [modalCausar, setModalCausar] = useState(false);
  const [incluirMora, setIncluirMora] = useState(true);
  const [causando, setCausando] = useState(false);

  const bloqueado = esPeriodoBloqueado(estado, estado.periodo);
  const puedeCausar = tienePermiso(auth.user.rol, 'maestros');

  const filas = useMemo(
    () => cartera(estado.comprobantes, empresa, DATOS.units.filter((u) => u.empresaId === empresa.id), DATOS.terceros, estado.periodo),
    [estado.comprobantes, empresa, estado.periodo],
  );

  const filtradas = useMemo(() => {
    let out = filas;
    if (filtros.unidadId) out = out.filter((f) => f.unidad.id === filtros.unidadId);
    const needle = norm(q.trim());
    if (needle) {
      out = out.filter((f) =>
        norm(
          `${f.unidad.torre} ${f.unidad.numero} ${f.propietario?.nombre ?? ''} ${f.arrendatario?.nombre ?? ''} ${f.unidad.matricula}`,
        ).includes(needle),
      );
    }
    return out;
  }, [filas, filtros.unidadId, q]);

  const totales = useMemo(() => {
    const saldo = filtradas.reduce((s, f) => s + f.saldo, 0);
    const vencida = filtradas.filter((f) => f.estado === 'EN_MORA').reduce((s, f) => s + f.saldo, 0);
    const alDia = filtradas.filter((f) => f.estado === 'AL_DIA').length;
    const congeladas = filtradas.filter((f) => f.estado === 'CONGELADA').length;
    const mora = filtradas.filter((f) => f.estado === 'EN_MORA').length;
    return { saldo, vencida, alDia, congeladas, mora };
  }, [filtradas]);

  const antiguedad = useMemo(() => {
    const buckets = [
      { key: '1-30', label: '1 a 30 días', min: 1, max: 30, total: 0, n: 0 },
      { key: '31-60', label: '31 a 60 días', min: 31, max: 60, total: 0, n: 0 },
      { key: '61-90', label: '61 a 90 días', min: 61, max: 90, total: 0, n: 0 },
      { key: '90+', label: 'Más de 90 días', min: 91, max: 9999, total: 0, n: 0 },
    ];
    for (const f of filtradas) {
      if (f.saldo <= 0) continue;
      const b = buckets.find((x) => f.diasVencido >= x.min && f.diasVencido <= x.max);
      if (b) {
        b.total += f.saldo;
        b.n += 1;
      }
    }
    return buckets;
  }, [filtradas]);

  const exportar = () => {
    const encabezado = ['Unidad', 'Coeficiente', 'Propietario', 'Arrendatario', 'Cuota', 'Cargado', 'Pagado', 'Saldo', 'Días vencido', 'Estado'];
    const lineas = filtradas.map((f) => [
      `${f.unidad.torre} ${f.unidad.numero}`,
      f.coeficiente,
      f.propietario?.nombre ?? '',
      f.arrendatario?.nombre ?? '',
      cuotaMensual(empresa, f.unidad),
      f.cargado,
      f.pagado,
      f.saldo,
      f.diasVencido,
      f.estado,
    ]);
    const csv = [encabezado, ...lineas]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    descargarArchivo(`cartera-${empresa.id}-${estado.periodo}.csv`, `﻿${csv}`, 'text/csv;charset=utf-8');
    toast({ tone: 'ok', title: 'Cartera exportada', msg: `${filtradas.length} unidades` });
  };

  const descargarPazYSalvo = (f: (typeof filas)[number]) => {
    const html = generarPazYSalvoHTML(empresa, f, estado.periodo);
    descargarArchivo(
      `paz-y-salvo-${empresa.id}-${f.unidad.torre.replace(/\s+/g, '')}-${f.unidad.numero}.html`,
      html,
      'text/html;charset=utf-8',
    );
    toast({
      tone: 'ok',
      title: 'Paz y salvo generado',
      msg: `${f.unidad.torre} ${f.unidad.numero} · Ley 675`,
    });
  };

  const ejecutarCausacion = async () => {
    setCausando(true);
    try {
      const res = await acciones.causarExpensasMes(estado.periodo, incluirMora);
      if (res.ok) {
        toast({ tone: 'ok', title: 'Expensas causadas', msg: res.detalle });
        setModalCausar(false);
      } else {
        toast({ tone: 'error', title: 'No se pudo causar', msg: res.error });
      }
    } finally {
      setCausando(false);
    }
  };

  return (
    <div className="vista">
      <ViewHeader
        icon="wallet"
        title="Cartera y paz y salvo"
        subtitle={`${empresa.nombreCorto} · ${fmtPeriodo(estado.periodo)}`}
        actions={
          <>
            <Badge tone={modo === 0 ? 'info' : 'neutral'}>{modo === 0 ? 'Vista: unidades' : 'Vista: antigüedad'}</Badge>
            <Btn
              size="sm"
              variant="primary"
              icon="spark"
              onClick={() => setModalCausar(true)}
              disabled={bloqueado || !puedeCausar}
              title={
                !puedeCausar
                  ? 'Requiere rol Contador o Administrador'
                  : bloqueado
                    ? 'Periodo cerrado o sin abrir'
                    : 'Liquidar expensas ordinarias del mes'
              }
            >
              Causar expensas del mes
            </Btn>
            <Btn size="sm" icon="download" onClick={exportar} disabled={filtradas.length === 0}>
              Exportar CSV
            </Btn>
          </>
        }
      />

      <div className="stat-grid">
        <Stat label="Cartera total" value={fmtMoney(totales.saldo)} tone={totales.saldo > 0 ? 'warn' : 'ok'} icon="wallet" />
        <Stat label="Cartera vencida" value={fmtMoney(totales.vencida)} tone={totales.vencida > 0 ? 'error' : 'neutral'} icon="alert" />
        <Stat label="Unidades al día" value={totales.alDia} tone="ok" icon="check" />
        <Stat label="Unidades en mora" value={totales.mora} tone={totales.mora > 0 ? 'warn' : 'neutral'} icon="clock" />
      </div>

      <div className="toolbar">
        <div className="search">
          <input value={q} placeholder="Buscar por unidad, propietario o matrícula…" onChange={(e) => setQ(e.target.value)} />
        </div>
        {filtros.unidadId && (
          <Chip
            label={`Unidad ${filtros.unidadId}`}
            onClear={() => setFiltros({ unidadId: undefined })}
          />
        )}
      </div>

      {filtradas.length === 0 ? (
        <Empty icon="wallet" title="Sin cartera" text="Todas las unidades están al día o no hay resultados para el filtro." />
      ) : modo === 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Unidad</th>
                <th className="num">Coef.</th>
                <th>Propietario</th>
                <th>Arrendatario</th>
                <th className="num">Cuota</th>
                <th className="num">Cargado</th>
                <th className="num">Pagado</th>
                <th className="num">Saldo</th>
                <th>Antigüedad</th>
                <th>Estado</th>
                <th>Certificado</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((f) => (
                <tr key={f.unidad.id}>
                  <td>
                    <strong>
                      {f.unidad.torre} {f.unidad.numero}
                    </strong>
                    <span className="unidad-matricula mono">{f.unidad.matricula}</span>
                  </td>
                  <td className="num">{fmtCoef(f.coeficiente)}</td>
                  <td className="celda-tercero">
                    <span>{f.propietario?.nombre}</span>
                    <small>{f.propietario?.documento}</small>
                  </td>
                  <td className="celda-tercero">
                    {f.arrendatario ? (
                      <>
                        <span>{f.arrendatario.nombre}</span>
                        <small>{f.arrendatario.documento}</small>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="num">{fmtMoney(cuotaMensual(empresa, f.unidad))}</td>
                  <td className="num">{fmtMoney(f.cargado)}</td>
                  <td className="num">{fmtMoney(f.pagado)}</td>
                  <td className={`num ${f.saldo > 0 ? 'text-warn' : 'text-ok'}`}>{fmtMoney(f.saldo)}</td>
                  <td>{f.diasVencido > 0 ? `${f.diasVencido} días` : '—'}</td>
                  <td>
                    {f.estado === 'AL_DIA' && <Badge tone="ok">Paz y salvo</Badge>}
                    {f.estado === 'EN_MORA' && <Badge tone="error">En mora</Badge>}
                    {f.estado === 'POR_VENCER' && <Badge tone="warn">Por vencer</Badge>}
                    {f.estado === 'CONGELADA' && <Badge tone="info">Congelada</Badge>}
                  </td>
                  <td>
                    {f.estado === 'AL_DIA' ? (
                      <Btn size="xs" icon="download" onClick={() => descargarPazYSalvo(f)}>
                        Paz y salvo
                      </Btn>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Rango de antigüedad</th>
                <th className="num">Unidades</th>
                <th className="num">Saldo</th>
                <th className="w-48">Participación</th>
              </tr>
            </thead>
            <tbody>
              {antiguedad.map((b) => (
                <tr key={b.key}>
                  <td>{b.label}</td>
                  <td className="num">{b.n}</td>
                  <td className="num">{fmtMoney(b.total)}</td>
                  <td>
                    <div className="progress-cell">
                      <div className="progress">
                        <div
                          className={`progress-bar ${b.key === '90+' ? 'progress-error' : b.key === '61-90' ? 'progress-warn' : 'progress-ok'}`}
                          style={{ width: `${totales.saldo > 0 ? (b.total / totales.saldo) * 100 : 0}%` }}
                        />
                      </div>
                      <small>{totales.saldo > 0 ? `${((b.total / totales.saldo) * 100).toFixed(1)}%` : '0%'}</small>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalCausar}
        onClose={() => setModalCausar(false)}
        title="Causación masiva de expensas"
        subtitle={`${empresa.nombreCorto} · ${fmtPeriodo(estado.periodo)}`}
        width={520}
      >
        <p className="card-note" style={{ marginTop: 0 }}>
          Se liquidará el presupuesto mensual ({fmtMoney(empresa.presupuestoAnual / 12)}) distribuido por
          coeficiente entre {filas.length} unidades, apropiando {empresa.fondoImprevistosPct}% al fondo de imprevistos
          (cuenta <span className="mono">281510</span>).
        </p>
        <div className="checklist" style={{ marginBottom: 14 }}>
          <div className="check-item">
            <Toggle checked={incluirMora} onChange={setIncluirMora} />
            <div>
              <strong>Liquidar intereses de mora ({empresa.tasaMoraMensual}% mensual)</strong>
              <small>Aplica a unidades con saldo vencido anterior cuya cartera no esté congelada.</small>
            </div>
          </div>
        </div>
        <div className="cierre-acciones" style={{ justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={() => setModalCausar(false)}>
            Cancelar
          </Btn>
          <Btn variant="primary" icon="check" onClick={() => void ejecutarCausacion()} disabled={causando}>
            {causando ? 'Causando…' : 'Confirmar causación (CC)'}
          </Btn>
        </div>
      </Modal>
    </div>
  );
}
