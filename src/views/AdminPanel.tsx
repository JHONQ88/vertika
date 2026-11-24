import { useCallback, useEffect, useState } from 'react';
import {
  adminCreateContadorApi,
  adminUpdateUserApi,
  fetchAdminOverviewApi,
  type AdminContadorItem,
  type AdminOverviewResponse,
} from '../api';
import type { ToastData } from '../ui-types';
import { Badge, Btn, Modal, ViewHeader } from '../components/ui';

function fmtFechaCorta(iso: string | null): string {
  if (!iso) return 'Sin vencimiento';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function diasRestantes(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function AdminPanel({ toast }: { toast: (t: ToastData) => void }) {
  const [data, setData] = useState<AdminOverviewResponse | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalCrear, setModalCrear] = useState(false);
  const [mutandoId, setMutandoId] = useState<string | null>(null);

  // Form crear contador
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [planNombre, setPlanNombre] = useState('PRUEBA');
  const [maxCopropiedades, setMaxCopropiedades] = useState('1');
  const [diasPrueba, setDiasPrueba] = useState('14');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetchAdminOverviewApi();
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el panel de control.');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchAdminOverviewApi()
      .then((res) => {
        if (active) setData(res);
      })
      .catch((e: unknown) => {
        if (active) {
          setError(e instanceof Error ? e.message : 'No se pudo cargar el panel de control.');
        }
      })
      .finally(() => {
        if (active) setCargando(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const crearContador = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    try {
      const diasNum = Number(diasPrueba);
      const maxNum = Number(maxCopropiedades);
      const res = await adminCreateContadorApi({
        nombre: nombre.trim(),
        email: email.trim(),
        password,
        planNombre: planNombre.trim() || 'PRUEBA',
        maxCopropiedades: Number.isFinite(maxNum) && maxNum >= 1 ? maxNum : 1,
        diasPrueba: Number.isFinite(diasNum) && diasNum > 0 ? diasNum : undefined,
      });
      toast({
        tone: 'ok',
        title: 'Contador creado',
        msg: `${res.user.nombre} · Cupo ${res.user.maxCopropiedades ?? 1} copropiedad(es)`,
      });
      setNombre('');
      setEmail('');
      setPassword('');
      setPlanNombre('PRUEBA');
      setMaxCopropiedades('1');
      setDiasPrueba('14');
      setModalCrear(false);
      await cargar();
    } catch (err: unknown) {
      toast({
        tone: 'error',
        title: 'No se pudo crear el contador',
        msg: err instanceof Error ? err.message : 'Error inesperado',
      });
    } finally {
      setGuardando(false);
    }
  };

  const actualizarCuenta = async (
    item: AdminContadorItem,
    patch: Parameters<typeof adminUpdateUserApi>[1],
    msgOk: string,
  ) => {
    setMutandoId(item.id);
    try {
      await adminUpdateUserApi(item.id, patch);
      toast({ tone: 'ok', title: 'Cuenta actualizada', msg: `${item.nombre} · ${msgOk}` });
      await cargar();
    } catch (err: unknown) {
      toast({
        tone: 'error',
        title: 'Error actualizando cuenta',
        msg: err instanceof Error ? err.message : 'Error inesperado',
      });
    } finally {
      setMutandoId(null);
    }
  };

  return (
    <div className="page">
      <ViewHeader
        icon="shield"
        title="Control de plataforma"
        subtitle="Gestión de firmas contables, cupos de copropiedades y vigencias de prueba"
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn size="sm" variant="outline" onClick={() => void cargar()} disabled={cargando}>
              Actualizar datos
            </Btn>
            <Btn size="sm" variant="primary" icon="plus" onClick={() => setModalCrear(true)}>
              Crear contador
            </Btn>
          </div>
        }
      />

      {error && (
        <div className="card" style={{ borderColor: '#dc2626', color: '#991b1b' }}>
          <strong>Error al cargar panel:</strong> {error}
        </div>
      )}

      {data && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <small>Contadores registrados</small>
              <strong className="mono">{data.totalContadores}</strong>
              <span>{data.contadoresActivos} activos actualmente</span>
            </div>
            <div className="stat-card">
              <small>Copropiedades en plataforma</small>
              <strong className="mono">{data.totalCopropiedades}</strong>
              <span>Edificios y conjuntos activos</span>
            </div>
            <div className="stat-card">
              <small>Pruebas vigentes</small>
              <strong className="mono">{data.pruebasActivas}</strong>
              <span>Con fecha límite configurada</span>
            </div>
            <div className="stat-card">
              <small>Suspendidos o vencidos</small>
              <strong className="mono">{data.cuentasSuspendidasOVencidas}</strong>
              <span>Acceso bloqueado automáticamente</span>
            </div>
          </div>

          <section className="card">
            <div className="card-head">
              <div>
                <h3>Firmas y contadores</h3>
                <p className="card-note">
                  Cada contador crea sus propias copropiedades y usuarios de apoyo dentro de su cupo autorizado.
                </p>
              </div>
            </div>

            {data.contadores.length === 0 ? (
              <p className="card-note" style={{ margin: '12px 0 0' }}>
                Aún no hay contadores registrados. Usa «Crear contador» para habilitar la primera cuenta de prueba.
              </p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Contador / Firma</th>
                      <th>Plan y vigencia</th>
                      <th className="num">Cupo conjuntos</th>
                      <th className="num">Equipo</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.contadores.map((c) => {
                      const dias = diasRestantes(c.expiresAt);
                      const busy = mutandoId === c.id;
                      const pct = Math.min(
                        100,
                        Math.round((c.copropiedadesUsadas / Math.max(1, c.maxCopropiedades)) * 100),
                      );
                      return (
                        <tr key={c.id}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{c.nombre}</div>
                            <div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                              {c.email}
                            </div>
                            {c.copropiedades.length > 0 && (
                              <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 4 }}>
                                {c.copropiedades.map((co) => co.nombreCorto).join(' · ')}
                              </div>
                            )}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: 12.5 }}>{c.planNombre}</div>
                            <div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                              {fmtFechaCorta(c.expiresAt)}
                              {dias !== null && dias > 0 ? ` (${dias} d)` : ''}
                            </div>
                          </td>
                          <td className="num">
                            <div className="mono" style={{ fontWeight: 600 }}>
                              {c.copropiedadesUsadas} / {c.maxCopropiedades}
                            </div>
                            <div
                              style={{
                                height: 4,
                                background: 'var(--line)',
                                borderRadius: 2,
                                marginTop: 5,
                                overflow: 'hidden',
                                minWidth: 72,
                              }}
                            >
                              <div
                                style={{
                                  height: '100%',
                                  width: `${pct}%`,
                                  background: pct >= 100 ? '#b45309' : 'var(--accent)',
                                }}
                              />
                            </div>
                          </td>
                          <td className="num mono">{c.usuariosCreados}</td>
                          <td>
                            {!c.activo ? (
                              <Badge tone="error">Suspendido</Badge>
                            ) : c.vencido ? (
                              <Badge tone="warn">Vencido</Badge>
                            ) : c.expiresAt ? (
                              <Badge tone="info">Prueba</Badge>
                            ) : (
                              <Badge tone="ok">Activo</Badge>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <Btn
                                size="xs"
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                  void actualizarCuenta(
                                    c,
                                    { maxCopropiedades: c.maxCopropiedades + 1 },
                                    `Cupo ampliado a ${c.maxCopropiedades + 1}`,
                                  )
                                }
                              >
                                +1 cupo
                              </Btn>
                              <Btn
                                size="xs"
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                  void actualizarCuenta(c, { extendDays: 15 }, '+15 días de vigencia')
                                }
                              >
                                +15 días
                              </Btn>
                              {c.expiresAt && (
                                <Btn
                                  size="xs"
                                  variant="ghost"
                                  disabled={busy}
                                  onClick={() =>
                                    void actualizarCuenta(
                                      c,
                                      { expiresAt: '', planNombre: 'ACTIVO' },
                                      'Activado sin vencimiento',
                                    )
                                  }
                                >
                                  Activar plan
                                </Btn>
                              )}
                              <Btn
                                size="xs"
                                variant={c.activo ? 'danger' : 'primary'}
                                disabled={busy}
                                onClick={() =>
                                  void actualizarCuenta(
                                    c,
                                    { activo: !c.activo },
                                    c.activo ? 'Cuenta suspendida' : 'Cuenta reactivada',
                                  )
                                }
                              >
                                {c.activo ? 'Suspender' : 'Reactivar'}
                              </Btn>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <Modal
        open={modalCrear}
        onClose={() => setModalCrear(false)}
        title="Crear cuenta de contador"
        subtitle="El contador podrá crear sus copropiedades y equipo dentro del cupo definido"
        width={520}
      >
        <form onSubmit={crearContador} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="field">
            <span>Nombre completo o firma</span>
            <input
              required
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. Laura Gómez · Contadora PH"
            />
          </label>
          <label className="field">
            <span>Correo de acceso</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="laura@firma.co"
            />
          </label>
          <label className="field">
            <span>Contraseña temporal (mínimo 8 caracteres)</span>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <label className="field">
              <span>Plan</span>
              <input
                value={planNombre}
                onChange={(e) => setPlanNombre(e.target.value)}
                placeholder="PRUEBA / FIRMA_5"
              />
            </label>
            <label className="field">
              <span>Cupo copropiedades</span>
              <input
                type="number"
                min={1}
                max={500}
                value={maxCopropiedades}
                onChange={(e) => setMaxCopropiedades(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Días de prueba (0 = ilimitado)</span>
              <input
                type="number"
                min={0}
                max={365}
                value={diasPrueba}
                onChange={(e) => setDiasPrueba(e.target.value)}
              />
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
            <Btn type="button" variant="ghost" onClick={() => setModalCrear(false)}>
              Cancelar
            </Btn>
            <Btn type="submit" variant="primary" disabled={guardando}>
              {guardando ? 'Creando cuenta…' : 'Crear contador'}
            </Btn>
          </div>
        </form>
      </Modal>
    </div>
  );
}
