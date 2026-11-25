import { useState } from 'react';
import { CUENTAS, TIPOS_CUENTA } from '../domain/puc';
import { fmtCoef, fmtMoney } from '../domain/format';
import type { CuentaPuc, RolTercero, Tercero, Unidad } from '../domain/types';
import { acciones, DATOS, tercerosDe, tienePermiso, unidadesDe, useAuth } from '../store';
import type { VistaProps } from '../ui-types';
import { Badge, Btn, Card, Modal, Toggle, ViewHeader } from '../components/ui';
import { ImportarCsvModal } from '../components/ImportarCsvModal';

type Tab = 'puc' | 'unidades' | 'terceros';

const TIPOS_PUC_EDITABLES: CuentaPuc['tipo'][] = ['ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'GASTO'];
const TIPOS_UNIDAD: Unidad['tipo'][] = ['APARTAMENTO', 'CASA', 'LOCAL'];
const ROLES_TERCERO: RolTercero[] = ['PROPIETARIO', 'ARRENDATARIO', 'PROVEEDOR', 'EMPLEADO'];

export function Maestros(props: VistaProps) {
  const { empresa, estado, toast } = props;
  const auth = useAuth();
  const puedeEditarMaestros = tienePermiso(auth.user.rol, 'maestros');
  const puedeCrearPuc = tienePermiso(auth.user.rol, 'contabilidad');

  const [tab, setTab] = useState<Tab>('puc');
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState<string>('TODOS');
  const [guardando, setGuardando] = useState(false);

  const [modalPuc, setModalPuc] = useState(false);
  const [pucForm, setPucForm] = useState<{
    codigo: string;
    nombre: string;
    tipo: CuentaPuc['tipo'];
    naturaleza: 'D' | 'C';
    rubroKey: string;
    requiereTercero: boolean;
    requiereUnidad: boolean;
    nota: string;
  }>({
    codigo: '',
    nombre: '',
    tipo: 'GASTO',
    naturaleza: 'D',
    rubroKey: '',
    requiereTercero: false,
    requiereUnidad: false,
    nota: '',
  });

  const [modalUnidad, setModalUnidad] = useState(false);
  const [editandoUnidadId, setEditandoUnidadId] = useState<string | null>(null);
  const [unidadForm, setUnidadForm] = useState<{
    torre: string;
    numero: string;
    tipo: Unidad['tipo'];
    area: string;
    coeficiente: string;
    matricula: string;
    propietarioId: string;
    arrendatarioId: string;
    carteraCongelada: boolean;
  }>({
    torre: 'Torre A',
    numero: '',
    tipo: 'APARTAMENTO',
    area: '70',
    coeficiente: '2.5',
    matricula: '',
    propietarioId: '',
    arrendatarioId: '',
    carteraCongelada: false,
  });

  const [modalTercero, setModalTercero] = useState(false);
  const [modalCopiarTerceros, setModalCopiarTerceros] = useState(false);
  const [importCsvKind, setImportCsvKind] = useState<'unidades' | 'terceros' | 'puc' | null>(null);
  const [origenCopiaId, setOrigenCopiaId] = useState('');
  const [copiandoTerceros, setCopiandoTerceros] = useState(false);
  const otrasCopropiedades = DATOS.companies.filter((c) => c.id !== empresa.id);
  const [editandoTerceroId, setEditandoTerceroId] = useState<string | null>(null);
  const [terceroForm, setTerceroForm] = useState<{
    nombre: string;
    tipo: RolTercero;
    documento: string;
    dv: string;
    email: string;
    telefono: string;
    ciudad: string;
    retefuentePct: string;
    reteicaPct: string;
    reteivaPct: string;
    noObligado: boolean;
    regimenEspecial: boolean;
  }>({
    nombre: '',
    tipo: 'PROVEEDOR',
    documento: '',
    dv: '',
    email: '',
    telefono: '',
    ciudad: empresa.ciudad,
    retefuentePct: '0',
    reteicaPct: '0',
    reteivaPct: '0',
    noObligado: false,
    regimenEspecial: false,
  });

  const needle = q.trim().toLowerCase();
  const todasUnidades = unidadesDe(estado);
  const todosTerceros = tercerosDe(estado);
  const rubrosEmpresa = DATOS.rubros.filter((r) => r.empresaId === empresa.id);

  const puc = CUENTAS.filter((c) => tipo === 'TODOS' || c.tipo === tipo).filter(
    (c) => !needle || `${c.codigo} ${c.nombre}`.toLowerCase().includes(needle),
  );

  const unidades = todasUnidades.filter((u) => {
    if (!needle) return true;
    const prop = todosTerceros.find((t) => t.id === u.propietarioId);
    return `${u.torre} ${u.numero} ${u.matricula} ${prop?.nombre ?? ''}`.toLowerCase().includes(needle);
  });

  const terceros = todosTerceros.filter(
    (t) => !needle || `${t.nombre} ${t.documento}`.toLowerCase().includes(needle),
  );

  const coefTotal = unidades.reduce((s, u) => s + u.coeficiente, 0);

  const abrirNuevaCuenta = () => {
    setPucForm({
      codigo: '',
      nombre: '',
      tipo: 'GASTO',
      naturaleza: 'D',
      rubroKey: '',
      requiereTercero: false,
      requiereUnidad: false,
      nota: '',
    });
    setModalPuc(true);
  };

  const abrirNuevaUnidad = () => {
    const propDef = todosTerceros.find((t) => t.tipo === 'PROPIETARIO') ?? todosTerceros[0];
    setEditandoUnidadId(null);
    setUnidadForm({
      torre: 'Torre A',
      numero: '',
      tipo: 'APARTAMENTO',
      area: '70',
      coeficiente: '2.5',
      matricula: '',
      propietarioId: propDef?.id ?? '',
      arrendatarioId: '',
      carteraCongelada: false,
    });
    setModalUnidad(true);
  };

  const abrirEditarUnidad = (u: Unidad) => {
    setEditandoUnidadId(u.id);
    setUnidadForm({
      torre: u.torre,
      numero: u.numero,
      tipo: u.tipo,
      area: String(u.area),
      coeficiente: String(u.coeficiente),
      matricula: u.matricula,
      propietarioId: u.propietarioId,
      arrendatarioId: u.arrendatarioId ?? '',
      carteraCongelada: u.carteraCongelada,
    });
    setModalUnidad(true);
  };

  const abrirNuevoTercero = () => {
    setEditandoTerceroId(null);
    setTerceroForm({
      nombre: '',
      tipo: 'PROVEEDOR',
      documento: '',
      dv: '',
      email: '',
      telefono: '',
      ciudad: empresa.ciudad,
      retefuentePct: '0',
      reteicaPct: '0',
      reteivaPct: '0',
      noObligado: false,
      regimenEspecial: false,
    });
    setModalTercero(true);
  };

  const abrirEditarTercero = (t: Tercero) => {
    setEditandoTerceroId(t.id);
    setTerceroForm({
      nombre: t.nombre,
      tipo: t.tipo,
      documento: t.documento,
      dv: t.dv ?? '',
      email: t.email,
      telefono: t.telefono,
      ciudad: t.ciudad,
      retefuentePct: String(t.retefuentePct),
      reteicaPct: String(t.reteicaPct),
      reteivaPct: String(t.reteivaPct),
      noObligado: t.noObligado,
      regimenEspecial: Boolean(t.regimenEspecial),
    });
    setModalTercero(true);
  };

  const guardarPuc = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    try {
      const res = await acciones.crearCuentaPuc({
        codigo: pucForm.codigo.trim(),
        nombre: pucForm.nombre.trim(),
        tipo: pucForm.tipo,
        naturaleza: pucForm.naturaleza,
        rubroKey: pucForm.rubroKey || undefined,
        requiereTercero: pucForm.requiereTercero,
        requiereUnidad: pucForm.requiereUnidad,
        nota: pucForm.nota.trim() || undefined,
      });
      if (res.ok) {
        toast({ tone: 'ok', title: 'Cuenta PUC creada', msg: res.detalle });
        setModalPuc(false);
      } else {
        toast({ tone: 'error', title: 'No se pudo crear la cuenta', msg: res.error });
      }
    } finally {
      setGuardando(false);
    }
  };

  const guardarUnidad = async (e: React.FormEvent) => {
    e.preventDefault();
    const area = Number(unidadForm.area);
    const coeficiente = Number(unidadForm.coeficiente);
    if (!Number.isFinite(area) || area <= 0 || !Number.isFinite(coeficiente) || coeficiente <= 0) {
      toast({ tone: 'error', title: 'Datos inválidos', msg: 'Área y coeficiente deben ser mayores a cero.' });
      return;
    }
    if (!unidadForm.propietarioId) {
      toast({ tone: 'error', title: 'Propietario requerido', msg: 'Selecciona un propietario válido.' });
      return;
    }
    const payload = {
      torre: unidadForm.torre.trim(),
      numero: unidadForm.numero.trim(),
      tipo: unidadForm.tipo,
      area,
      coeficiente,
      matricula: unidadForm.matricula.trim(),
      propietarioId: unidadForm.propietarioId,
      arrendatarioId: unidadForm.arrendatarioId || undefined,
      carteraCongelada: unidadForm.carteraCongelada,
    };
    setGuardando(true);
    try {
      const res = editandoUnidadId
        ? await acciones.actualizarUnidad(editandoUnidadId, payload)
        : await acciones.crearUnidad(payload);
      if (res.ok) {
        toast({
          tone: 'ok',
          title: editandoUnidadId ? 'Unidad actualizada' : 'Unidad creada',
          msg: res.detalle,
        });
        setModalUnidad(false);
      } else {
        toast({ tone: 'error', title: 'No se pudo guardar la unidad', msg: res.error });
      }
    } finally {
      setGuardando(false);
    }
  };

  const guardarTercero = async (e: React.FormEvent) => {
    e.preventDefault();
    const retefuentePct = Number(terceroForm.retefuentePct || '0');
    const reteicaPct = Number(terceroForm.reteicaPct || '0');
    const reteivaPct = Number(terceroForm.reteivaPct || '0');
    if (
      [retefuentePct, reteicaPct, reteivaPct].some((v) => !Number.isFinite(v) || v < 0)
    ) {
      toast({ tone: 'error', title: 'Retenciones inválidas', msg: 'Los porcentajes deben ser números >= 0.' });
      return;
    }
    const payload = {
      nombre: terceroForm.nombre.trim(),
      tipo: terceroForm.tipo,
      documento: terceroForm.documento.trim(),
      dv: terceroForm.dv.trim() || undefined,
      email: terceroForm.email.trim(),
      telefono: terceroForm.telefono.trim(),
      ciudad: terceroForm.ciudad.trim(),
      retefuentePct,
      reteicaPct,
      reteivaPct,
      noObligado: terceroForm.noObligado,
      regimenEspecial: terceroForm.regimenEspecial,
    };
    setGuardando(true);
    try {
      const res = editandoTerceroId
        ? await acciones.actualizarTercero(editandoTerceroId, payload)
        : await acciones.crearTercero(payload);
      if (res.ok) {
        toast({
          tone: 'ok',
          title: editandoTerceroId ? 'Tercero actualizado' : 'Tercero creado',
          msg: res.detalle,
        });
        setModalTercero(false);
      } else {
        toast({ tone: 'error', title: 'No se pudo guardar el tercero', msg: res.error });
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="vista">
      <ViewHeader
        icon="database"
        title="Maestros"
        subtitle={`${empresa.nombreCorto} · PUC ESAL, unidades inmobiliarias y terceros`}
        actions={
          <>
            {tab === 'puc' && puedeCrearPuc && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn variant="outline" size="sm" icon="download" onClick={() => setImportCsvKind('puc')}>
                  Importar PUC Excel/CSV
                </Btn>
                <Btn variant="primary" size="sm" icon="plus" onClick={abrirNuevaCuenta}>
                  Nueva cuenta
                </Btn>
              </div>
            )}
            {tab === 'unidades' && puedeEditarMaestros && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn variant="outline" size="sm" icon="download" onClick={() => setImportCsvKind('unidades')}>
                  Importar Excel/CSV
                </Btn>
                <Btn variant="primary" size="sm" icon="plus" onClick={abrirNuevaUnidad}>
                  Nueva unidad
                </Btn>
              </div>
            )}
            {tab === 'terceros' && puedeEditarMaestros && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn variant="outline" size="sm" icon="download" onClick={() => setImportCsvKind('terceros')}>
                  Importar Excel/CSV
                </Btn>
                {otrasCopropiedades.length > 0 && (
                  <Btn
                    variant="outline"
                    size="sm"
                    icon="layers"
                    onClick={() => {
                      setOrigenCopiaId(otrasCopropiedades[0]?.id ?? '');
                      setModalCopiarTerceros(true);
                    }}
                  >
                    Copiar de otro conjunto
                  </Btn>
                )}
                <Btn variant="primary" size="sm" icon="plus" onClick={abrirNuevoTercero}>
                  Nuevo tercero
                </Btn>
              </div>
            )}
          </>
        }
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
                  {puedeEditarMaestros && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {unidades.map((u) => {
                  const prop = todosTerceros.find((t) => t.id === u.propietarioId);
                  const arr = u.arrendatarioId ? todosTerceros.find((t) => t.id === u.arrendatarioId) : undefined;
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
                      {puedeEditarMaestros && (
                        <td>
                          <Btn size="xs" variant="ghost" onClick={() => abrirEditarUnidad(u)}>
                            Editar
                          </Btn>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Total {unidades.length} unidades</td>
                  <td className="num">{coefTotal.toFixed(6)}%</td>
                  <td colSpan={puedeEditarMaestros ? 5 : 4}>
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
                {puedeEditarMaestros && <th>Acciones</th>}
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
                  {puedeEditarMaestros && (
                    <td>
                      <Btn size="xs" variant="ghost" onClick={() => abrirEditarTercero(t)}>
                        Editar
                      </Btn>
                    </td>
                  )}
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

      <Modal
        open={modalPuc}
        onClose={() => setModalPuc(false)}
        title="Nueva cuenta PUC ESAL"
        subtitle={`${empresa.nombreCorto} · Catálogo Orientación Técnica 15`}
        width={640}
      >
        <form onSubmit={(e) => void guardarPuc(e)}>
          <div className="campos" style={{ gridTemplateColumns: '160px 1fr', marginBottom: 12 }}>
            <label className="campo">
              <small>Código PUC</small>
              <input
                required
                value={pucForm.codigo}
                placeholder="Ej. 519530"
                onChange={(e) => setPucForm((prev) => ({ ...prev, codigo: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="campo">
              <small>Nombre de la cuenta</small>
              <input
                required
                value={pucForm.nombre}
                placeholder="Ej. Mantenimiento de planta eléctrica"
                onChange={(e) => setPucForm((prev) => ({ ...prev, nombre: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="campo">
              <small>Tipo</small>
              <select
                value={pucForm.tipo}
                onChange={(e) =>
                  setPucForm((prev) => ({ ...prev, tipo: e.target.value as CuentaPuc['tipo'] }))
                }
                style={{ width: '100%', marginTop: 4 }}
              >
                {TIPOS_PUC_EDITABLES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <small>Naturaleza</small>
              <select
                value={pucForm.naturaleza}
                onChange={(e) =>
                  setPucForm((prev) => ({ ...prev, naturaleza: e.target.value as 'D' | 'C' }))
                }
                style={{ width: '100%', marginTop: 4 }}
              >
                <option value="D">Débito (D)</option>
                <option value="C">Crédito (C)</option>
              </select>
            </label>
            <label className="campo">
              <small>Rubro presupuestal (opcional)</small>
              <select
                value={pucForm.rubroKey}
                onChange={(e) => setPucForm((prev) => ({ ...prev, rubroKey: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              >
                <option value="">Sin rubro asociado</option>
                {rubrosEmpresa.map((r) => (
                  <option key={r.id} value={r.key}>
                    {r.key} · {r.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <small>Nota técnica (opcional)</small>
              <input
                value={pucForm.nota}
                placeholder="Uso o alcance contable"
                onChange={(e) => setPucForm((prev) => ({ ...prev, nota: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
          </div>
          <div className="checklist" style={{ marginBottom: 14 }}>
            <div className="check-item">
              <Toggle
                checked={pucForm.requiereTercero}
                onChange={(v) => setPucForm((prev) => ({ ...prev, requiereTercero: v }))}
              />
              <div>
                <strong>Requiere tercero</strong>
                <small>Obligatorio identificar proveedor, propietario o entidad en cada movimiento.</small>
              </div>
            </div>
            <div className="check-item">
              <Toggle
                checked={pucForm.requiereUnidad}
                onChange={(v) => setPucForm((prev) => ({ ...prev, requiereUnidad: v }))}
              />
              <div>
                <strong>Requiere unidad inmobiliaria</strong>
                <small>Asocia el saldo al módulo individual de cartera por inmueble.</small>
              </div>
            </div>
          </div>
          <div className="cierre-acciones" style={{ justifyContent: 'flex-end' }}>
            <Btn variant="ghost" type="button" onClick={() => setModalPuc(false)}>
              Cancelar
            </Btn>
            <Btn variant="primary" type="submit" icon="check" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Crear cuenta PUC'}
            </Btn>
          </div>
        </form>
      </Modal>

      <Modal
        open={modalUnidad}
        onClose={() => setModalUnidad(false)}
        title={editandoUnidadId ? 'Editar unidad inmobiliaria' : 'Nueva unidad inmobiliaria'}
        subtitle={`${empresa.nombreCorto} · Coeficientes y propietarios Ley 675`}
        width={680}
      >
        <form onSubmit={(e) => void guardarUnidad(e)}>
          <div className="campos" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 12 }}>
            <label className="campo">
              <small>Torre / Sector</small>
              <input
                required
                value={unidadForm.torre}
                onChange={(e) => setUnidadForm((prev) => ({ ...prev, torre: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="campo">
              <small>Número</small>
              <input
                required
                value={unidadForm.numero}
                placeholder="Ej. 502"
                onChange={(e) => setUnidadForm((prev) => ({ ...prev, numero: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="campo">
              <small>Tipo</small>
              <select
                value={unidadForm.tipo}
                onChange={(e) =>
                  setUnidadForm((prev) => ({ ...prev, tipo: e.target.value as Unidad['tipo'] }))
                }
                style={{ width: '100%', marginTop: 4 }}
              >
                {TIPOS_UNIDAD.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <small>Área m²</small>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                value={unidadForm.area}
                onChange={(e) => setUnidadForm((prev) => ({ ...prev, area: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="campo">
              <small>Coeficiente (%)</small>
              <input
                required
                type="number"
                step="0.0001"
                min="0.0001"
                value={unidadForm.coeficiente}
                onChange={(e) => setUnidadForm((prev) => ({ ...prev, coeficiente: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="campo">
              <small>Matrícula inmobiliaria</small>
              <input
                required
                value={unidadForm.matricula}
                placeholder="Ej. 50N-20394810"
                onChange={(e) => setUnidadForm((prev) => ({ ...prev, matricula: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
          </div>
          <div className="campos" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 12 }}>
            <label className="campo">
              <small>Propietario</small>
              <select
                required
                value={unidadForm.propietarioId}
                onChange={(e) => setUnidadForm((prev) => ({ ...prev, propietarioId: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              >
                <option value="">Seleccionar propietario…</option>
                {todosTerceros.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre} ({t.documento})
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <small>Arrendatario (opcional)</small>
              <select
                value={unidadForm.arrendatarioId}
                onChange={(e) => setUnidadForm((prev) => ({ ...prev, arrendatarioId: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              >
                <option value="">Sin arrendatario</option>
                {todosTerceros.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre} ({t.documento})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="checklist" style={{ marginBottom: 14 }}>
            <div className="check-item">
              <Toggle
                checked={unidadForm.carteraCongelada}
                onChange={(v) => setUnidadForm((prev) => ({ ...prev, carteraCongelada: v }))}
              />
              <div>
                <strong>Cartera congelada</strong>
                <small>Excluye la unidad de liquidación automática de intereses de mora.</small>
              </div>
            </div>
          </div>
          <div className="cierre-acciones" style={{ justifyContent: 'flex-end' }}>
            <Btn variant="ghost" type="button" onClick={() => setModalUnidad(false)}>
              Cancelar
            </Btn>
            <Btn variant="primary" type="submit" icon="check" disabled={guardando}>
              {guardando ? 'Guardando…' : editandoUnidadId ? 'Guardar cambios' : 'Crear unidad'}
            </Btn>
          </div>
        </form>
      </Modal>

      <Modal
        open={modalTercero}
        onClose={() => setModalTercero(false)}
        title={editandoTerceroId ? 'Editar tercero' : 'Nuevo tercero'}
        subtitle={`${empresa.nombreCorto} · Propietarios, proveedores y parámetros tributarios`}
        width={700}
      >
        <form onSubmit={(e) => void guardarTercero(e)}>
          <div className="campos" style={{ gridTemplateColumns: '1fr 180px', marginBottom: 12 }}>
            <label className="campo">
              <small>Nombre o razón social</small>
              <input
                required
                value={terceroForm.nombre}
                onChange={(e) => setTerceroForm((prev) => ({ ...prev, nombre: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="campo">
              <small>Tipo</small>
              <select
                value={terceroForm.tipo}
                onChange={(e) =>
                  setTerceroForm((prev) => ({ ...prev, tipo: e.target.value as RolTercero }))
                }
                style={{ width: '100%', marginTop: 4 }}
              >
                {ROLES_TERCERO.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="campos" style={{ gridTemplateColumns: '1fr 90px 1fr 1fr', marginBottom: 12 }}>
            <label className="campo">
              <small>Documento / NIT</small>
              <input
                required
                value={terceroForm.documento}
                onChange={(e) => setTerceroForm((prev) => ({ ...prev, documento: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="campo">
              <small>DV</small>
              <input
                value={terceroForm.dv}
                placeholder="Ej. 3"
                onChange={(e) => setTerceroForm((prev) => ({ ...prev, dv: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="campo">
              <small>Correo electrónico</small>
              <input
                type="email"
                value={terceroForm.email}
                onChange={(e) => setTerceroForm((prev) => ({ ...prev, email: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="campo">
              <small>Teléfono</small>
              <input
                value={terceroForm.telefono}
                onChange={(e) => setTerceroForm((prev) => ({ ...prev, telefono: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
          </div>
          <div className="campos" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 12 }}>
            <label className="campo">
              <small>Ciudad</small>
              <input
                value={terceroForm.ciudad}
                onChange={(e) => setTerceroForm((prev) => ({ ...prev, ciudad: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="campo">
              <small>ReteFuente (%)</small>
              <input
                type="number"
                step="0.01"
                min="0"
                value={terceroForm.retefuentePct}
                onChange={(e) => setTerceroForm((prev) => ({ ...prev, retefuentePct: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="campo">
              <small>ReteICA (%)</small>
              <input
                type="number"
                step="0.001"
                min="0"
                value={terceroForm.reteicaPct}
                onChange={(e) => setTerceroForm((prev) => ({ ...prev, reteicaPct: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="campo">
              <small>ReteIVA (%)</small>
              <input
                type="number"
                step="0.01"
                min="0"
                value={terceroForm.reteivaPct}
                onChange={(e) => setTerceroForm((prev) => ({ ...prev, reteivaPct: e.target.value }))}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
          </div>
          <div className="checklist" style={{ marginBottom: 14 }}>
            <div className="check-item">
              <Toggle
                checked={terceroForm.noObligado}
                onChange={(v) => setTerceroForm((prev) => ({ ...prev, noObligado: v }))}
              />
              <div>
                <strong>No obligado a facturar</strong>
                <small>Genera Documento Soporte (DS) en adquisiciones con este tercero.</small>
              </div>
            </div>
            <div className="check-item">
              <Toggle
                checked={terceroForm.regimenEspecial}
                onChange={(v) => setTerceroForm((prev) => ({ ...prev, regimenEspecial: v }))}
              />
              <div>
                <strong>Régimen tributario especial</strong>
                <small>Aplica para ESAL, cooperativas o entidades clasificadas en el RTE.</small>
              </div>
            </div>
          </div>
          <div className="cierre-acciones" style={{ justifyContent: 'flex-end' }}>
            <Btn variant="ghost" type="button" onClick={() => setModalTercero(false)}>
              Cancelar
            </Btn>
            <Btn variant="primary" type="submit" icon="check" disabled={guardando}>
              {guardando ? 'Guardando…' : editandoTerceroId ? 'Guardar cambios' : 'Crear tercero'}
            </Btn>
          </div>
        </form>
      </Modal>

      <Modal
        open={modalCopiarTerceros}
        onClose={() => setModalCopiarTerceros(false)}
        title="Copiar terceros de otra copropiedad"
        subtitle={`Importa proveedores y terceros hacia ${empresa.nombreCorto} sin duplicar documentos`}
        width={480}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!origenCopiaId) return;
            setCopiandoTerceros(true);
            try {
              const res = await acciones.copiarTercerosDeOtraEmpresa(empresa.id, origenCopiaId);
              if (res.ok) {
                toast({ tone: 'ok', title: 'Terceros copiados', msg: res.detalle });
                setModalCopiarTerceros(false);
              } else {
                toast({ tone: 'error', title: 'No se pudieron copiar', msg: res.error });
              }
            } finally {
              setCopiandoTerceros(false);
            }
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <label className="field">
            <span>Copropiedad origen (solo tus conjuntos)</span>
            <select
              required
              value={origenCopiaId}
              onChange={(e) => setOrigenCopiaId(e.target.value)}
            >
              {otrasCopropiedades.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombreCorto} ({c.nit})
                </option>
              ))}
            </select>
          </label>
          <p className="card-note" style={{ margin: 0 }}>
            Los terceros cuyo NIT o cédula ya exista en <strong>{empresa.nombreCorto}</strong> se
            omitirán automáticamente.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <Btn variant="ghost" type="button" onClick={() => setModalCopiarTerceros(false)}>
              Cancelar
            </Btn>
            <Btn variant="primary" type="submit" disabled={copiandoTerceros || !origenCopiaId}>
              {copiandoTerceros ? 'Copiando…' : 'Copiar terceros'}
            </Btn>
          </div>
        </form>
      </Modal>

      {importCsvKind && (
        <ImportarCsvModal
          open={true}
          kind={importCsvKind}
          empresa={empresa}
          estado={estado}
          onClose={() => setImportCsvKind(null)}
          toast={toast}
        />
      )}
    </div>
  );
}
