import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import type { Toast } from '../ui-types';

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="vertika-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#12B886" />
          <stop offset="100%" stopColor="#0B7285" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#vertika-g)" />
      <path
        d="M9 23.5 16 8.5l7 15"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="23.5" r="1.7" fill="#fff" />
    </svg>
  );
}

type BtnVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'subtle';
type BtnSize = 'xs' | 'sm' | 'md';

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: IconName;
}

export function Btn({ variant = 'outline', size = 'md', icon, className = '', children, ...rest }: BtnProps) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'xs' ? 13 : 15} />}
      {children}
    </button>
  );
}

type BadgeTone = 'neutral' | 'ok' | 'warn' | 'error' | 'info' | 'accent';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  padded = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'ok' | 'warn' | 'error' | 'accent';
  icon?: IconName;
}) {
  return (
    <div className={`stat stat-${tone}`}>
      <div className="stat-top">
        <span>{label}</span>
        {icon && <Icon name={icon} size={15} />}
      </div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function ProgressBar({ pct, tone = 'auto', height = 7 }: { pct: number; tone?: 'auto' | 'ok' | 'warn' | 'error'; height?: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = tone === 'auto' ? (clamped >= 100 ? 'error' : clamped >= 90 ? 'warn' : 'ok') : tone;
  return (
    <div className="progress" style={{ height }}>
      <div className={`progress-bar progress-${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function KeyCap({ k, label, onClick, disabled }: { k: string; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button className={`keycap ${disabled ? 'is-disabled' : ''}`} onClick={onClick} disabled={disabled} title={label}>
      <span className="keycap-k">{k}</span>
      <span className="keycap-label">{label}</span>
    </button>
  );
}

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  width = 560,
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true">
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle ${disabled ? 'is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      {label && <span className="toggle-label">{label}</span>}
    </label>
  );
}

export function Empty({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={26} />
      </div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function ViewHeader({
  icon,
  title,
  subtitle,
  actions,
}: {
  icon: IconName;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="view-head">
      <div className="view-title">
        <span className="view-icon">
          <Icon name={icon} size={19} />
        </span>
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="view-actions">{actions}</div>}
    </div>
  );
}

export function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <Icon name={t.tone === 'ok' ? 'check' : t.tone === 'error' ? 'alert' : 'spark'} size={17} />
          <div>
            <strong>{t.title}</strong>
            {t.msg && <span>{t.msg}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Chip({ label, onClear }: { label: string; onClear?: () => void }) {
  return (
    <span className="chip">
      {label}
      {onClear && (
        <button onClick={onClear} aria-label={`Quitar ${label}`}>
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  );
}
