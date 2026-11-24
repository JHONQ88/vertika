import { Icon } from './Icon';
import { Badge, Logo } from './ui';
import { fmtPeriodo } from '../domain/format';
import { NAV, type ViewKey } from '../ui-types';
import type { SyncStatus } from '../store';
import type { AuthUser } from '../api';

export function Topbar({
  empresa,
  pendientes,
  periodo,
  bloqueado,
  syncStatus,
  usuario,
  onEmpresas,
  onPeriodo,
  onAyuda,
  onAuth,
  onCopiloto,
  onMenu,
}: {
  empresa: { nombreCorto: string; sigla: string; color: string; nit: string };
  pendientes: number;
  periodo: string;
  bloqueado: boolean;
  syncStatus?: SyncStatus;
  usuario?: AuthUser;
  onEmpresas: () => void;
  onPeriodo: () => void;
  onAyuda: () => void;
  onAuth?: () => void;
  onCopiloto?: () => void;
  onMenu?: () => void;
}) {
  const modeLabel =
    syncStatus?.mode === 'postgres'
      ? 'PostgreSQL'
      : syncStatus?.mode === 'demo-memory'
        ? 'API memoria'
        : 'Modo local';
  const modeTone = syncStatus?.lastError
    ? 'warn'
    : syncStatus?.mode === 'postgres'
      ? 'ok'
      : syncStatus?.mode === 'demo-memory'
        ? 'info'
        : 'neutral';

  return (
    <header className="topbar">
      <div className="topbar-left">
        {onMenu && (
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={onMenu}
            aria-label="Abrir menú de navegación"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          </button>
        )}
        <div className="brand">
          <Logo size={30} />
          <div className="brand-text">
            <strong>VÉRTIKA</strong>
            <span>Contabilidad de copropiedades</span>
          </div>
        </div>
        <button
          type="button"
          className="mobile-context-pill"
          onClick={onEmpresas}
          title="Cambiar de copropiedad"
        >
          <span className="mobile-context-dot" style={{ background: empresa.color }} />
          <span className="mobile-context-label">{empresa.nombreCorto}</span>
          <Icon name="chevronDown" size={12} />
        </button>
      </div>

      <div className="topbar-center">
        <button className="selector" onClick={onEmpresas}>
          <span className="selector-avatar" style={{ background: empresa.color }}>
            {empresa.sigla}
          </span>
          <span className="selector-text">
            <small>{empresa.nit}</small>
            <strong>{empresa.nombreCorto}</strong>
          </span>
          <Icon name="chevronDown" size={14} />
        </button>

        <button className="selector" onClick={onPeriodo}>
          <span className="selector-icon">
            <Icon name="calendar" size={16} />
          </span>
          <span className="selector-text">
            <small>Periodo contable</small>
            <strong>
              {fmtPeriodo(periodo)}
              {bloqueado && <Icon name="lock" size={12} className="lock-inline" />}
            </strong>
          </span>
          <Icon name="chevronDown" size={14} />
        </button>
      </div>

      <div className="topbar-right">
        {syncStatus && (
          <span title={syncStatus.lastError ?? `Persistencia: ${modeLabel}`}>
            <Badge tone={modeTone}>
              {syncStatus.syncing ? 'Sincronizando…' : syncStatus.lastError ? `${modeLabel} · aviso` : modeLabel}
            </Badge>
          </span>
        )}
        <button
          type="button"
          className="ia-status"
          onClick={onCopiloto}
          style={{ cursor: 'pointer' }}
          title="Abrir Copiloto Contable Eve IA"
        >
          <span className="pulse" />
          <span>Copiloto Eve IA</span>
          {pendientes > 0 && <span className="ia-count">{pendientes}</span>}
        </button>
        <button className="icon-btn" onClick={onAyuda} title="Ayuda (F1)">
          <Icon name="help" size={18} />
        </button>
        <button
          type="button"
          className="user-chip"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
          onClick={onAuth}
          title="Cambiar usuario / rol (RBAC)"
        >
          <span className="user-avatar">
            {(usuario?.nombre ?? 'LC')
              .split(' ')
              .slice(0, 2)
              .map((w) => w[0] ?? '')
              .join('')
              .toUpperCase()}
          </span>
          <div className="user-text">
            <strong>{usuario?.nombre ?? 'Lina Castro'}</strong>
            <small>{usuario?.rol ?? 'CONTADOR'} · Multi-conjunto</small>
          </div>
        </button>
      </div>
    </header>
  );
}

export function Sidebar({
  view,
  setView,
  empresa,
  pendientes,
  periodo,
  bloqueado,
  isSuperAdmin,
}: {
  view: ViewKey;
  setView: (v: ViewKey) => void;
  empresa: { nombreCorto: string; grupoNiif: number; nit: string; ciudad: string };
  pendientes: number;
  periodo: string;
  bloqueado: boolean;
  isSuperAdmin?: boolean;
}) {
  return (
    <aside className="sidebar">
      <nav>
        {isSuperAdmin && (
          <div className="nav-group">
            <small>Plataforma</small>
            <button
              className={`nav-item ${view === 'admin' ? 'is-active' : ''}`}
              onClick={() => setView('admin')}
            >
              <Icon name="shield" size={17} />
              <span>Control de plataforma</span>
            </button>
          </div>
        )}
        {NAV.map((grupo) => (
          <div key={grupo.grupo} className="nav-group">
            <small>{grupo.grupo}</small>
            {grupo.items.map((item) => (
              <button
                key={item.key}
                className={`nav-item ${view === item.key ? 'is-active' : ''}`}
                onClick={() => setView(item.key)}
              >
                <Icon name={item.icon} size={17} />
                <span>{item.label}</span>
                {item.key === 'bandeja' && pendientes > 0 && <span className="nav-badge">{pendientes}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="foot-card">
          <div className="foot-row">
            <span>Periodo</span>
            <strong>{fmtPeriodo(periodo)}</strong>
          </div>
          <div className="foot-row">
            <span>Estado</span>
            <strong className={bloqueado ? 'text-warn' : 'text-ok'}>
              {bloqueado ? 'Cerrado' : 'Abierto'}
            </strong>
          </div>
          <div className="foot-row">
            <span>NIIF</span>
            <strong>Grupo {empresa.grupoNiif}</strong>
          </div>
        </div>
        <div className="foot-brand">
          <Logo size={20} />
          <span>Vértika 1.0</span>
        </div>
      </div>
    </aside>
  );
}

export function MobileDrawer({
  open,
  onClose,
  view,
  setView,
  empresa,
  pendientes,
  periodo,
  bloqueado,
  isSuperAdmin,
  puedeCrearEmpresa,
  onEmpresas,
  onPeriodo,
  onNuevaEmpresa,
}: {
  open: boolean;
  onClose: () => void;
  view: ViewKey;
  setView: (v: ViewKey) => void;
  empresa: { nombreCorto: string; sigla: string; color: string; nit: string; grupoNiif: number };
  pendientes: number;
  periodo: string;
  bloqueado: boolean;
  isSuperAdmin?: boolean;
  puedeCrearEmpresa?: boolean;
  onEmpresas: () => void;
  onPeriodo: () => void;
  onNuevaEmpresa: () => void;
}) {
  if (!open) return null;
  return (
    <div className="mobile-drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="mobile-drawer"
        onClick={(e) => e.stopPropagation()}
        aria-label="Navegación móvil"
      >
        <div className="mobile-drawer-head">
          <div className="brand">
            <Logo size={26} />
            <div className="brand-text">
              <strong>VÉRTIKA</strong>
              <span>Propiedad horizontal</span>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar menú">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="mobile-drawer-selectors">
          <button
            type="button"
            className="selector"
            onClick={() => {
              onClose();
              onEmpresas();
            }}
          >
            <span className="selector-avatar" style={{ background: empresa.color }}>
              {empresa.sigla}
            </span>
            <span className="selector-text">
              <small>{empresa.nit}</small>
              <strong>{empresa.nombreCorto}</strong>
            </span>
            <Icon name="chevronRight" size={14} />
          </button>

          <button
            type="button"
            className="selector"
            onClick={() => {
              onClose();
              onPeriodo();
            }}
          >
            <span className="selector-icon">
              <Icon name="calendar" size={16} />
            </span>
            <span className="selector-text">
              <small>Periodo contable</small>
              <strong>
                {fmtPeriodo(periodo)}
                {bloqueado && <Icon name="lock" size={12} className="lock-inline" />}
              </strong>
            </span>
            <Icon name="chevronRight" size={14} />
          </button>

          {puedeCrearEmpresa && (
            <button
              type="button"
              className="nav-item"
              style={{ border: '1px solid var(--line)', background: 'var(--surface)' }}
              onClick={() => {
                onClose();
                onNuevaEmpresa();
              }}
            >
              <Icon name="plus" size={16} />
              <span>Crear copropiedad</span>
            </button>
          )}
        </div>

        <nav className="mobile-drawer-nav">
          {isSuperAdmin && (
            <div className="nav-group">
              <small>Plataforma</small>
              <button
                type="button"
                className={`nav-item ${view === 'admin' ? 'is-active' : ''}`}
                onClick={() => {
                  setView('admin');
                  onClose();
                }}
              >
                <Icon name="shield" size={17} />
                <span>Control de plataforma</span>
              </button>
            </div>
          )}
          {NAV.map((grupo) => (
            <div key={grupo.grupo} className="nav-group">
              <small>{grupo.grupo}</small>
              {grupo.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`nav-item ${view === item.key ? 'is-active' : ''}`}
                  onClick={() => {
                    setView(item.key);
                    onClose();
                  }}
                >
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                  {item.key === 'bandeja' && pendientes > 0 && (
                    <span className="nav-badge">{pendientes}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
    </div>
  );
}

export function MobileBottomNav({
  view,
  setView,
  pendientes,
  onOpenMenu,
}: {
  view: ViewKey;
  setView: (v: ViewKey) => void;
  pendientes: number;
  onOpenMenu: () => void;
}) {
  const items: Array<{ key: ViewKey; label: string; icon: 'bot' | 'wallet' | 'scale' | 'pie' }> = [
    { key: 'bandeja', label: 'Bandeja', icon: 'bot' },
    { key: 'cartera', label: 'Cartera', icon: 'wallet' },
    { key: 'balance', label: 'Balance', icon: 'scale' },
    { key: 'presupuesto', label: 'Presup.', icon: 'pie' },
  ];

  return (
    <nav className="mobile-bottom-nav" aria-label="Accesos principales">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className={`mobile-tab ${view === it.key ? 'is-active' : ''}`}
          onClick={() => setView(it.key)}
        >
          <span className="mobile-tab-icon">
            <Icon name={it.icon} size={19} />
            {it.key === 'bandeja' && pendientes > 0 && (
              <span className="mobile-tab-dot">{pendientes > 9 ? '9+' : pendientes}</span>
            )}
          </span>
          <span>{it.label}</span>
        </button>
      ))}
      <button type="button" className="mobile-tab" onClick={onOpenMenu}>
        <span className="mobile-tab-icon">
          <Icon name="layers" size={19} />
        </span>
        <span>Menú</span>
      </button>
    </nav>
  );
}

const TECLAS: Array<{ k: string; label: string }> = [
  { k: 'F1', label: 'Ayuda' },
  { k: 'F2', label: 'Buscar' },
  { k: 'F3', label: 'Conjunto' },
  { k: 'F4', label: 'Periodo' },
  { k: 'F6', label: 'Acarreo IA' },
  { k: 'F10', label: 'Asentar' },
  { k: 'F11', label: 'Vistas' },
];

export function FKeyBar({ onKey }: { onKey: (k: string) => void }) {
  return (
    <footer className="fkeys">
      <div className="fkeys-inner">
        {TECLAS.map((t) => (
          <button key={t.k} className="fkey" onClick={() => onKey(t.k)} title={`${t.label} (${t.k})`}>
            <kbd>{t.k}</kbd>
            <span>{t.label}</span>
          </button>
        ))}
        <div className="fkeys-status">
          <span className="dot dot-ok" />
          <span>Motor contable determinista · partida doble validada</span>
        </div>
      </div>
    </footer>
  );
}
