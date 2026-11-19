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
      <div className="brand">
        <Logo size={30} />
        <div className="brand-text">
          <strong>VÉRTIKA</strong>
          <span>Contabilidad de copropiedades</span>
        </div>
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
        <div className="ia-status" title="Agentes de IA activos">
          <span className="pulse" />
          <span>IA activa</span>
          {pendientes > 0 && <span className="ia-count">{pendientes}</span>}
        </div>
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
}: {
  view: ViewKey;
  setView: (v: ViewKey) => void;
  empresa: { nombreCorto: string; grupoNiif: number; nit: string; ciudad: string };
  pendientes: number;
  periodo: string;
  bloqueado: boolean;
}) {
  return (
    <aside className="sidebar">
      <nav>
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
          <span>Vértika 1.0 · demo</span>
        </div>
      </div>
    </aside>
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
