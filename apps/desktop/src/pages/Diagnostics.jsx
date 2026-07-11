import { useEffect, useState } from 'react';
import { Activity, Server, Terminal, Cpu, Cloud, Sparkles, CreditCard, AlertCircle, Copy, Download, RefreshCw } from 'lucide-react';
import { useApp } from '../lib/store.jsx';
import { bridge } from '../lib/bridge.js';

/**
 * Diagnostics: aggregates real status from every subsystem Ember talks to.
 * Nothing here is simulated — each row reflects a live check or an honest
 * "not configured" state.
 */
function StatusRow({ icon: Icon, label, detail, ok, warn }) {
  const state = ok === null ? 'dim' : ok ? 'ok' : warn ? 'warn' : 'err';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <Icon size={16} color="var(--accent-soft)" style={{ flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</div>
      </div>
      <span className={`chip ${state}`}>{ok === null ? 'unknown' : ok ? 'ok' : warn ? 'warn' : 'fail'}</span>
    </div>
  );
}

export default function Diagnostics() {
  const { api, backendHealth, project, activity, toast } = useApp();
  const [sys, setSys] = useState(null);
  const [ai, setAi] = useState(null);
  const [cloud, setCloud] = useState(null);
  const [providers, setProviders] = useState(null);
  const [doctorResult, setDoctorResult] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [s, a, c, p, d] = await Promise.allSettled([
      bridge.systemInfo(),
      bridge.agent.aiStatus(),
      api.cloudHealth(),
      api.paymentProviders(),
      bridge.agent.doctor(project?.root)
    ]);
    setSys(s.status === 'fulfilled' ? s.value : null);
    setAi(a.status === 'fulfilled' ? a.value : null);
    setCloud(c.status === 'fulfilled' ? c.value : { ok: false, reason: 'unreachable' });
    setProviders(p.status === 'fulfilled' ? p.value : []);
    setDoctorResult(d.status === 'fulfilled' ? d.value : null);
    setLoading(false);
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lastErrors = activity.filter((a) => a.icon === '✗').slice(0, 5);

  const summaryText = () => {
    const lines = [
      '# Ember Diagnostics', new Date().toISOString(), '',
      `Backend: ${backendHealth?.ok ? `healthy v${backendHealth.version}` : 'offline'}`,
      `Cloud (Supabase): ${cloud?.ok ? 'healthy' : `not ok (${cloud?.reason ?? 'unknown'})`}`,
      `AI: ${ai?.enabled ? `${ai.label} (${ai.model})` : 'not configured'}`,
      `Payment providers: ${(providers ?? []).map((p) => `${p.label}=${p.available ? 'available' : 'not available'}`).join(', ') || 'none'}`,
      `Node: ${sys?.nodeVersion ?? '—'} · Electron: ${sys?.electronVersion ?? '—'} · OS: ${sys?.platform ?? '—'} ${sys?.osRelease ?? ''}`,
      `Ember CLI on PATH: ${sys?.cliInstalled ? 'yes' : 'no'}`,
      `Current project: ${project?.config?.projectName ?? 'none connected'}`,
      '',
      '## Agent doctor', ...((doctorResult?.checks ?? []).map((c) => `[${c.status}] ${c.name}: ${c.detail}${c.remedy ? ` — ${c.remedy}` : ''}`)),
      '',
      '## Recent errors', ...(lastErrors.length ? lastErrors.map((e) => `${e.time} — ${e.text}`) : ['none recorded this session'])
    ];
    return lines.join('\n');
  };

  const copyDiagnostics = () => {
    navigator.clipboard?.writeText(summaryText()).then(() => toast('Diagnostics copied to clipboard'), () => toast('Clipboard unavailable'));
  };

  const exportDiagnostics = async () => {
    const f = await bridge.file.saveAs({ title: 'Export diagnostics', defaultPath: 'ember-diagnostics.txt', content: summaryText() });
    if (f) toast(`Exported ${f}`);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '6px 0 18px' }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: '-.02em' }}>Diagnostics</h2>
        <span className="micro-mono">every row below is a real, live check</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}><RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh</button>
        <button className="btn btn-ghost btn-sm" onClick={copyDiagnostics}><Copy size={13} /> Copy</button>
        <button className="btn btn-white btn-sm" onClick={exportDiagnostics}><Download size={13} /> Export</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="acct-panel">
          <h3>Services</h3>
          <StatusRow icon={Server} label="Ember Backend" detail={backendHealth?.ok ? `Healthy · v${backendHealth.version}` : 'Offline — start it with npm run dev:backend'} ok={!!backendHealth?.ok} />
          <StatusRow icon={Cloud} label="Ember Cloud (Supabase)" detail={cloud?.ok ? 'Cloud sync healthy' : (cloud?.reason ?? 'Add SUPABASE_SERVICE_ROLE_KEY to enable')} ok={cloud ? cloud.ok : null} />
          <StatusRow icon={Sparkles} label="AI provider" detail={ai?.enabled ? `${ai.label} (${ai.model})${ai.fallback?.length ? ` · falls back to ${ai.fallback.join(', ')}` : ''}` : (ai?.reason ?? 'Not configured')} ok={ai ? !!ai.enabled : null} warn />
          {(providers ?? []).map((p) => (
            <StatusRow key={p.id} icon={CreditCard} label={`Payments — ${p.label}`} detail={p.note ?? (p.available ? 'Ready' : 'Not configured')} ok={p.available} warn />
          ))}
        </div>

        <div className="acct-panel">
          <h3>Machine</h3>
          <StatusRow icon={Cpu} label="Node.js" detail={sys?.nodeVersion ? `v${sys.nodeVersion}` : (sys?.browserPreview ? 'Browser preview — desktop shell required' : 'unknown')} ok={sys ? !!sys.nodeVersion : null} />
          <StatusRow icon={Cpu} label="Electron" detail={sys?.electronVersion ? `v${sys.electronVersion} (Chrome ${sys.chromeVersion})` : 'Browser preview'} ok={sys ? !!sys.electronVersion : null} />
          <StatusRow icon={Activity} label="OS" detail={sys?.platform ? `${sys.platform}${sys.osRelease ? ` ${sys.osRelease}` : ''}${sys.arch ? ` (${sys.arch})` : ''}` : 'unknown'} ok={sys?.browserPreview ? null : (sys ? !!sys.platform : null)} />
          <StatusRow icon={Terminal} label="Ember CLI on PATH" detail={sys?.cliInstalled ? 'Installed — `ember` command available' : 'Not found — npm link --workspace @ember/agent'} ok={sys ? sys.cliInstalled : null} warn />
        </div>

        <div className="acct-panel" style={{ gridColumn: '1 / -1' }}>
          <h3>Agent doctor{project?.config?.projectName ? ` — ${project.config.projectName}` : ''}</h3>
          {loading && <div className="sub">Loading…</div>}
          {!loading && !doctorResult?.checks && <div className="sub">{doctorResult?.error ?? 'Agent bridge unavailable — requires the Ember Desktop shell.'}</div>}
          {doctorResult?.checks?.map((c, i) => (
            <StatusRow key={i} icon={Activity} label={c.name} detail={c.remedy ? `${c.detail} — ${c.remedy}` : c.detail} ok={c.status === 'ok' ? true : c.status === 'warn' ? false : false} warn={c.status === 'warn'} />
          ))}
        </div>

        <div className="acct-panel" style={{ gridColumn: '1 / -1' }}>
          <h3><AlertCircle size={15} color="var(--err)" style={{ verticalAlign: -2 }} /> Recent errors (this session)</h3>
          {lastErrors.length === 0 && <div className="sub">No errors recorded this session.</div>}
          {lastErrors.map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--line)', fontSize: 12 }}>
              <span style={{ color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', fontSize: 10.5, flex: 'none' }}>{e.time}</span>
              <span style={{ color: 'var(--ink-dim)' }}>{e.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
