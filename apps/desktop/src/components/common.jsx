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
