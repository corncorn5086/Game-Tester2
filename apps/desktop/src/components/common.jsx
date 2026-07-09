import { AlertTriangle, FlaskConical, Loader2 } from 'lucide-react';
import { useApp } from '../lib/store.jsx';

export function Empty({ icon: Icon = FlaskConical, title, body, children }) {
  return (
    <div className="empty">
      <div className="icon">
        <Icon size={24} />
      </div>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {children}
    </div>
  );
}

export function Blocked({ children }) {
  return (
    <div className="blocked-banner">
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}

export function ErrorBanner({ children }) {
  return (
    <div className="error-banner">
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}

export function SevTag({ severity }) {
  return <span className={`sev sev-${severity}`}>{severity}</span>;
}

export function Stat({ label, value, meta, color, icon: Icon }) {
  return (
    <div className="stat-card">
      <div className="label">
        {Icon && <Icon size={12} />} {label}
      </div>
      <div className="value" style={color ? { color } : undefined}>{value}</div>
      {meta && <div className="meta">{meta}</div>}
    </div>
  );
}

export function Spinner({ size = 15 }) {
  return <Loader2 size={size} className="spin" />;
}

export function Toggle({ on, onChange }) {
  return <button type="button" className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} />;
}

export function SettingRow({ name, desc, children }) {
  return (
    <div className="setting-row">
      <div className="info">
        <div className="name">{name}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

/** Reusable confirm dialog for destructive/irreversible actions. */
export function ConfirmDialog({ title, body, confirmLabel = 'Confirm', danger = true, busy, onConfirm, onCancel }) {
  return (
    <div className="overlay" onClick={onCancel} style={{ alignItems: 'center', paddingTop: 0 }}>
      <div className="auth-card anim-scale" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{title}</h3>
        <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', lineHeight: 1.55, marginBottom: 20 }}>{body}</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-fire'}`} style={{ flex: 1 }} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Gate for modules that need a connected project. */
export function useProjectGate() {
  const { project, mode, setModule } = useApp();
  const gate =
    mode !== 'real' ? (
      <div className="empty-hero">
        <div className="e-title">No project connected</div>
        <div className="e-sub">Ember only shows real signals. Connect a game project to light this up.</div>
        <button className="btn btn-white" onClick={() => setModule('connect')}>Connect Game Project</button>
      </div>
    ) : null;
  return { project, mode, gate };
}
