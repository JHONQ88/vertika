import { useState } from 'react';
import { acciones, DEMO_PERFILES, useAuth } from '../store';
import type { ToastData } from '../ui-types';
import { Badge, Btn, Modal } from './ui';

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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sesión y control de acceso (RBAC)"
      subtitle="Cambia de rol para probar permisos por copropiedad o autentícate con JWT"
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

      <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Perfiles rápidos (clave demo: vertika2026)</h3>
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
        <div className="cierre-acciones" style={{ justifyContent: 'space-between' }}>
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
          <Btn type="submit" variant="primary" size="sm" disabled={cargando}>
            {cargando ? 'Ingresando…' : 'Iniciar sesión'}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
