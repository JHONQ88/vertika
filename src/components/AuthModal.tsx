import { useState } from 'react';
import { apiEnabled, DEMO_MODE_ENABLED, type UserRole } from '../api';
import { acciones, DATOS, DEMO_PERFILES, useAuth } from '../store';
import type { ToastData } from '../ui-types';
import { Badge, Btn, Modal } from './ui';

const ROLES_EQUIPO: Array<{ value: UserRole; label: string }> = [
  { value: 'ADMINISTRADOR', label: 'ADMINISTRADOR (Causación + maestros)' },
  { value: 'REVISOR_FISCAL', label: 'REVISOR_FISCAL (Auditoría solo lectura)' },
  { value: 'CONSEJO', label: 'CONSEJO (Consulta solo lectura)' },
];

export function AuthModal({
  open,
  onClose,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  toast: (t: ToastData) => void;
}) {
  const { user, token } = useAuth();
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);

  const [panelExtra, setPanelExtra] = useState<'none' | 'password' | 'usuario'>('none');
  const [claveActual, setClaveActual] = useState('');
  const [claveNueva, setClaveNueva] = useState('');

  const [nuevoEmail, setNuevoEmail] = useState('');
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoPassword, setNuevoPassword] = useState('');
  const [nuevoRol, setNuevoRol] = useState<UserRole>('ADMINISTRADOR');
  const [alcanceEmpresa, setAlcanceEmpresa] = useState<string>('ALL');

  const esSuperAdmin = user.rol === 'SUPER_ADMIN' || user.isSuperAdmin;
  const puedeCrearUsuarios =
    esSuperAdmin || user.rol === 'CONTADOR' || user.rol === 'ADMINISTRADOR';
  const rolesPermitidos = esSuperAdmin
    ? [{ value: 'CONTADOR' as UserRole, label: 'CONTADOR (Contabilidad + maestros)' }, ...ROLES_EQUIPO]
    : ROLES_EQUIPO;

  const loginManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    try {
      const res = await acciones.iniciarSesion(email, password);
      if (res.ok) {
        toast({ tone: 'ok', title: 'Sesión iniciada', msg: res.detalle });
        setPassword('');
        onClose();
      } else {
        toast({ tone: 'error', title: 'Error de acceso', msg: res.error });
      }
    } finally {
      setCargando(false);
    }
  };

  const cambiarPerfil = async (rol: (typeof DEMO_PERFILES)[number]['rol']) => {
    setCargando(true);
    try {
      const res = await acciones.cambiarRolDemo(rol);
      if (res.ok) {
        toast({ tone: 'ok', title: 'Perfil activo', msg: res.detalle });
        onClose();
      } else {
        toast({ tone: 'error', title: 'No se pudo cambiar', msg: res.error });
      }
    } finally {
      setCargando(false);
    }
  };

  const enviarCambioClave = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    try {
      const res = await acciones.cambiarPassword(claveActual, claveNueva);
      if (res.ok) {
        toast({ tone: 'ok', title: 'Contraseña actualizada', msg: res.detalle });
        setClaveActual('');
        setClaveNueva('');
        setPanelExtra('none');
      } else {
        toast({ tone: 'error', title: 'No se pudo cambiar la clave', msg: res.error });
      }
    } finally {
      setCargando(false);
    }
  };

  const enviarNuevoUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    try {
      const res = await acciones.crearUsuario({
        email: nuevoEmail,
        nombre: nuevoNombre,
        password: nuevoPassword,
        rol: nuevoRol,
        companyIds: alcanceEmpresa === 'ALL' ? undefined : [alcanceEmpresa],
      });
      if (res.ok) {
        toast({ tone: 'ok', title: 'Usuario creado', msg: res.detalle });
        setNuevoEmail('');
        setNuevoNombre('');
        setNuevoPassword('');
        setAlcanceEmpresa('ALL');
        setPanelExtra('none');
      } else {
        toast({ tone: 'error', title: 'No se pudo crear el usuario', msg: res.error });
      }
    } finally {
      setCargando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sesión y control de acceso (RBAC)"
      subtitle="Cambia de rol, autentícate con JWT o gestiona usuarios y contraseñas"
      width={620}
    >
      <div className="campos" style={{ marginBottom: 14 }}>
        <div className="campo">
          <small>Usuario activo</small>
          <strong>{user.nombre}</strong>
          <small>{user.email}</small>
        </div>
        <div className="campo">
          <small>Rol y sesión</small>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
            <Badge tone={user.rol === 'CONTADOR' ? 'ok' : user.rol === 'ADMINISTRADOR' ? 'info' : 'neutral'}>
              {user.rol}
            </Badge>
            <Badge tone={token ? 'ok' : 'neutral'}>{token ? 'JWT activo' : 'Demo local'}</Badge>
          </div>
        </div>
      </div>

      {DEMO_MODE_ENABLED && (
        <>
          <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Perfiles rápidos (entorno demo)</h3>
          <div className="empresas" style={{ marginBottom: 16 }}>
            {DEMO_PERFILES.map((p) => {
              const activo = user.rol === p.rol;
              return (
                <button
                  key={p.rol}
                  type="button"
                  className={`empresa-card ${activo ? 'is-active' : ''}`}
                  disabled={cargando}
                  onClick={() => void cambiarPerfil(p.rol)}
                >
                  <span className="empresa-info">
                    <strong>
                      {p.nombre} · {p.etiqueta}
                    </strong>
                    <small>{p.descripcion}</small>
                  </span>
                  <span className="empresa-meta">
                    <Badge tone={activo ? 'ok' : 'neutral'}>{p.rol}</Badge>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <form onSubmit={(e) => void loginManual(e)}>
        <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Iniciar sesión con correo y contraseña</h3>
        <div className="campos" style={{ marginBottom: 12 }}>
          <label className="campo">
            <small>Correo</small>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          <label className="campo">
            <small>Contraseña</small>
            <input
              type="password"
              required
              value={password}
              placeholder="vertika2026"
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
        </div>
        <div className="cierre-acciones" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                acciones.cerrarSesion();
                toast({ tone: 'info', title: 'Sesión restablecida al contador demo' });
                onClose();
              }}
            >
              Restablecer perfil
            </Btn>
            {apiEnabled && token && (
              <Btn
                type="button"
                variant={panelExtra === 'password' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setPanelExtra(panelExtra === 'password' ? 'none' : 'password')}
              >
                Cambiar contraseña
              </Btn>
            )}
            {apiEnabled && puedeCrearUsuarios && (
              <Btn
                type="button"
                variant={panelExtra === 'usuario' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setPanelExtra(panelExtra === 'usuario' ? 'none' : 'usuario')}
              >
                Nuevo usuario
              </Btn>
            )}
          </div>
          <Btn type="submit" variant="primary" size="sm" disabled={cargando}>
            {cargando ? 'Ingresando…' : 'Iniciar sesión'}
          </Btn>
        </div>
      </form>

      {panelExtra === 'password' && (
        <form
          onSubmit={(e) => void enviarCambioClave(e)}
          style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}
        >
          <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Cambiar mi contraseña</h3>
          <div className="campos" style={{ marginBottom: 10 }}>
            <label className="campo">
              <small>Contraseña actual</small>
              <input
                type="password"
                required
                value={claveActual}
                onChange={(e) => setClaveActual(e.target.value)}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="campo">
              <small>Nueva contraseña (mín. 8 caracteres)</small>
              <input
                type="password"
                required
                minLength={8}
                value={claveNueva}
                onChange={(e) => setClaveNueva(e.target.value)}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn type="button" variant="ghost" size="sm" onClick={() => setPanelExtra('none')}>
              Cancelar
            </Btn>
            <Btn type="submit" variant="primary" size="sm" disabled={cargando}>
              Guardar clave
            </Btn>
          </div>
        </form>
      )}

      {panelExtra === 'usuario' && (
        <form
          onSubmit={(e) => void enviarNuevoUsuario(e)}
          style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}
        >
          <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Registrar nuevo usuario</h3>
          <div className="campos" style={{ marginBottom: 10 }}>
            <label className="campo">
              <small>Nombre completo</small>
              <input
                type="text"
                required
                value={nuevoNombre}
                placeholder="Ej. Sofía Ramírez"
                onChange={(e) => setNuevoNombre(e.target.value)}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="campo">
              <small>Correo</small>
              <input
                type="email"
                required
                value={nuevoEmail}
                placeholder="usuario@copropiedad.co"
                onChange={(e) => setNuevoEmail(e.target.value)}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="campo">
              <small>Contraseña inicial (mín. 8 caracteres)</small>
              <input
                type="password"
                required
                minLength={8}
                value={nuevoPassword}
                onChange={(e) => setNuevoPassword(e.target.value)}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="campo">
              <small>Rol asignado</small>
              <select
                value={nuevoRol}
                onChange={(e) => setNuevoRol(e.target.value as UserRole)}
                style={{ width: '100%', marginTop: 4 }}
              >
                {rolesPermitidos.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <small>Copropiedades permitidas</small>
              <select
                value={alcanceEmpresa}
                onChange={(e) => setAlcanceEmpresa(e.target.value)}
                style={{ width: '100%', marginTop: 4 }}
              >
                <option value="ALL">Todas las copropiedades</option>
                {DATOS.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    Solo {c.nombreCorto} ({c.id})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn type="button" variant="ghost" size="sm" onClick={() => setPanelExtra('none')}>
              Cancelar
            </Btn>
            <Btn type="submit" variant="primary" size="sm" disabled={cargando}>
              Crear usuario
            </Btn>
          </div>
        </form>
      )}
    </Modal>
  );
}
