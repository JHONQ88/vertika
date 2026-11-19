import { useMemo, useState } from 'react';
import { CUENTAS, TIPOS_CUENTA } from '../domain/puc';
import { fmtCoef, fmtMoney } from '../domain/format';
import { DATOS } from '../store';
import type { VistaProps } from '../ui-types';
import { Badge, Card, ViewHeader } from '../components/ui';

type Tab = 'puc' | 'unidades' | 'terceros';

export function Maestros(props: VistaProps) {
  const { empresa } = props;
  const [tab, setTab] = useState<Tab>('puc');
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState<string>('TODOS');

  const puc = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return CUENTAS.filter((c) => tipo === 'TODOS' || c.tipo === tipo).filter(
      (c) => !needle || `${c.codigo} ${c.nombre}`.toLowerCase().includes(needle),
    );
  }, [q, tipo]);

  const unidades = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return DATOS.units
      .filter((u) => u.empresaId === empresa.id)
      .filter((u) => {
        if (!needle) return true;
        const prop = DATOS.terceros.find((t) => t.id === u.propietarioId);
        return `${u.torre} ${u.numero} ${u.matricula} ${prop?.nombre ?? ''}`.toLowerCase().includes(needle);
      });
  }, [empresa.id, q]);

  const terceros = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return DATOS.terceros
      .filter((t) => !t.empresaId || t.empresaId === empresa.id)
      .filter((t) => !needle || `${t.nombre} ${t.documento}`.toLowerCase().includes(needle));
  }, [empresa.id, q]);

  const coefTotal = unidades.reduce((s, u) => s + u.coeficiente, 0);

  return (
    <div className="vista">
      <ViewHeader
        icon="database"
        title="Maestros"
        subtitle={`${empresa.nombreCorto} · PUC ESAL, unidades inmobiliarias y terceros`}
      />

      <div className="toolbar">
        <div className="tabs">
          <button className={tab === 'puc' ? 'is-active' : ''} onClick={() => setTab('puc')}>
            PUC ESAL
          </button>
          <button className={tab === 'unidades' ? 'is-active' : ''} onClick={() => setTab('unidades')}>
            Unidades
          </button>
          <button className={tab === 'terceros' ? 'is-active' : ''} onClick={() => setTab('terceros')}>
            Terceros
          </button>
        </div>
        <div className="search">
          <input value={q} placeholder="Buscar…" onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {tab === 'puc' && (
        <>
          <div className="toolbar">
            <div className="tabs">
              {['TODOS', ...TIPOS_CUENTA].map((t) => (
                <button key={t} className={tipo === t ? 'is-active' : ''} onClick={() => setTipo(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th>Naturaleza</th>
                  <th>Rubro</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {puc.map((c) => (
                  <tr key={c.codigo}>
                    <td>
                      <span className="cuenta-cod">{c.codigo}</span>
                    </td>
                    <td>{c.nombre}</td>
                    <td>
                      <Badge tone="neutral">{c.tipo}</Badge>
                    </td>
                    <td>{c.naturaleza}</td>
                    <td className="celda-desc">{c.rubroKey ?? '—'}</td>
                    <td className="celda-desc">{c.nota ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'unidades' && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Unidad</th>
                  <th>Área m²</th>
                  <th className="num">Coeficiente</th>
                  <th>Matrícula</th>
                  <th>Propietario</th>
                  <th>Arrendatario</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {unidades.map((u) => {
                  const prop = DATOS.terceros.find((t) => t.id === u.propietarioId);
                  const arr = u.arrendatarioId ? DATOS.terceros.find((t) => t.id === u.arrendatarioId) : undefined;
                  return (
                    <tr key={u.id}>
                      <td>
                        <strong>
                          {u.torre} {u.numero}
                        </strong>
                        <small className="mono">{u.tipo}</small>
                      </td>
                      <td className="num">{u.area}</td>
                      <td className="num">{fmtCoef(u.coeficiente)}</td>
                      <td className="mono">{u.matricula}</td>
                      <td className="celda-tercero">
                        <span>{prop?.nombre}</span>
                        <small>{prop?.documento}</small>
                      </td>
                      <td className="celda-tercero">
                        {arr ? (
                          <>
                            <span>{arr.nombre}</span>
                            <small>{arr.documento}</small>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {u.carteraCongelada && <Badge tone="info">Congelada</Badge>}
                        {!u.carteraCongelada && arr && <Badge tone="neutral">Arrendada</Badge>}
                        {!u.carteraCongelada && !arr && <Badge tone="ok">Habitada</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Total {unidades.length} unidades</td>
                  <td className="num">{coefTotal.toFixed(6)}%</td>
                  <td colSpan={4}>
                    {Math.abs(coefTotal - 100) < 0.000001 ? (
                      <Badge tone="ok">Coeficientes cuadran al 100%</Badge>
                    ) : (
                      <Badge tone="error">Los coeficientes no cuadran</Badge>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {tab === 'terceros' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Documento</th>
                <th>Contacto</th>
                <th className="num">ReteFuente</th>
                <th className="num">ReteICA</th>
                <th className="num">ReteIVA</th>
              </tr>
            </thead>
            <tbody>
              {terceros.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.nombre}</strong>
                    <small className="mono">{t.ciudad}</small>
                  </td>
                  <td>
                    <Badge tone={t.tipo === 'PROVEEDOR' ? 'info' : 'neutral'}>{t.tipo}</Badge>
                  </td>
                  <td className="mono">
                    {t.documento}
                    {t.dv ? `-${t.dv}` : ''}
                  </td>
                  <td className="celda-tercero">
                    <span>{t.email}</span>
                    <small>{t.telefono}</small>
                  </td>
                  <td className="num">{t.retefuentePct}%</td>
                  <td className="num">{t.reteicaPct}%</td>
                  <td className="num">{t.reteivaPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab !== 'puc' && (
        <p className="pie-periodo">
          {tab === 'unidades'
            ? `${unidades.length} unidades registradas`
            : `${terceros.length} terceros registrados`}
        </p>
      )}

      <Card title="Nota técnica" subtitle="Estructura contable" padded>
        <p className="card-note">
          El catálogo está preconfigurado para Entidades Sin Ánimo de Lucro de propiedad horizontal según la
          Orientación Técnica No. 15 del CTCP y la Ley 675 de 2001. Los códigos y rubros son parametrizables por
          copropiedad en producción; el motor valida que cada comprobante cumpla partida doble antes de asentar.
        </p>
        <p className="card-note">
          Ejemplo de rubro: <strong>Vigilancia y seguridad</strong> con cuenta <span className="mono">513505</span> y
          presupuesto mensual de {fmtMoney((DATOS.rubros.find((r) => r.empresaId === empresa.id && r.key === 'VIG')?.presupuestoAnual ?? 0) / 12)}.
        </p>
      </Card>
    </div>
  );
}
