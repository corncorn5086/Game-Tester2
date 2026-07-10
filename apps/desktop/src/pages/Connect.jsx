import { useEffect, useState } from 'react';
import { useApp } from '../lib/store.jsx';
import { bridge, isDesktop } from '../lib/bridge.js';

/**
 * Connect (v2 connectors grid): 5 working connectors + honest coming-soon
 * placeholders. Working ones call the real bridge.
 */
export default function Connect() {
  const { project, connectProject, disconnectProject, setModule, setPhase, toast, settings, saveSettings, setProject, logsRes, setLogsRes, api, backendHealth } = useApp();
  const [pathInput, setPathInput] = useState('');
  const [initOffer, setInitOffer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cloud, setCloud] = useState(null);

  useEffect(() => {
    if (backendHealth?.ok) api.health().then((h) => setCloud(h.cloud)).catch(() => setCloud(null));
  }, [api, backendHealth?.ok]);

  const connect = async (dir) => {
    if (!dir) return;
    setBusy(true);
    const res = await connectProject(dir);
    setBusy(false);
    if (res?.needsInit) setInitOffer({ dir });
  };

  const pickProject = async () => {
    if (isDesktop) {
      const dir = await bridge.selectFolder('Select your game project folder');
      if (dir) connect(dir);
    } else if (pathInput) {
      connect(pathInput);
    } else {
      toast('Type a project path below — the native picker needs the desktop shell');
    }
  };

  const connectLogs = async () => {
    if (!project) return toast('Connect a project first — logsPath lives in its ember.config.json');
    let dir = null;
    if (isDesktop) dir = await bridge.selectFolder('Select the logs folder');
    if (!dir) return toast(isDesktop ? 'No folder selected' : 'Browser preview — edit logsPath in the config instead');
    const nextConfig = { ...project.config, logsPath: dir };
    const res = await bridge.config.write(project.configPath, nextConfig);
    if (res?.error) return toast(`Save failed: ${res.error}`);
    setProject({ ...project, config: nextConfig });
    const logs = await bridge.agent.logs(project.root);
    if (!logs?.error) setLogsRes(logs);
    toast(logs?.logsAnalyzed ? `Logs connected — ${logs.logsAnalyzed} file(s) parsed` : 'logsPath saved — no log files found there yet');
  };


  const cloudConnected = cloud?.enabled && cloud?.auth && !String(cloud.auth).startsWith('anon');

  const CONNECTORS = [
    { name: 'Local Project', icon: '◈', desc: 'Scan a project folder — files, engine detection, markers.', status: project ? 'Connected' : 'Available', action: () => (project ? toast('Project already connected') : pickProject()), btn: project ? 'Reconnect' : 'Connect' },
    { name: 'Build Folder', icon: '▣', desc: 'Attach a packaged build for launch checks (set launchCommand).', status: project?.config?.launchCommand ? 'Connected' : 'Needs setup', action: () => (project ? setModule('settings') : pickProject()), btn: 'Configure' },
    { name: 'Logs Folder', icon: '≡', desc: 'Parse .log / .txt / .json for errors, crashes, warnings.', status: project?.config?.logsPath ? 'Connected' : 'Available', action: connectLogs, btn: project?.config?.logsPath ? 'Re-pick folder' : 'Connect' },
    { name: 'Ember Config', icon: '{ }', desc: 'Edit, validate and preview ember.config.json — every field, no raw JSON editing required.', status: project ? 'Connected' : 'Available', action: () => (project ? setModule('configEditor') : pickProject()), btn: project ? 'Open editor' : 'Connect' },
    { name: 'Ember CLI', icon: '⌘', desc: 'Local agent: doctor, scan, analyze, report.', status: isDesktop ? 'Connected' : 'Desktop only', action: () => setModule('agent'), btn: 'Open Agent' },
    {
      name: 'Supabase', icon: '▤',
      desc: 'Cloud sync for projects, reports and team — works alongside the local backend.',
      status: !cloud ? (backendHealth?.ok ? 'Checking…' : 'Backend offline') : cloudConnected ? 'Connected' : cloud.enabled ? 'Needs service key' : 'Not configured',
      lastSync: cloud?.lastSyncAt ? new Date(cloud.lastSyncAt).toLocaleString() : null,
      action: () => setModule('diagnostics'), btn: 'View status'
    },
    { name: 'GitHub', icon: '⎇', desc: 'Sync issues + PR checks from your repo.', status: 'Coming soon' },
    { name: 'GitLab', icon: '⎇', desc: 'Pipeline hooks and issue sync.', status: 'Coming soon' },
    { name: 'Jira', icon: '◫', desc: 'Push Ember bugs into your Jira backlog.', status: 'Coming soon' },
    { name: 'Linear', icon: '◫', desc: 'One-click bug export to Linear.', status: 'Coming soon' },
    { name: 'Slack', icon: '◇', desc: 'Report digests + critical alerts in channels.', status: 'Coming soon' },
    { name: 'Discord', icon: '◇', desc: 'Alerts for your team server.', status: 'Coming soon' },
    { name: 'Unity Plugin', icon: '▲', desc: 'In-editor hooks: play-mode checks, live capture.', status: 'Coming soon' },
    { name: 'Unreal Plugin', icon: '▲', desc: 'In-editor hooks: PIE checks, Blueprint capture.', status: 'Coming soon' },
    { name: 'Godot Plugin', icon: '▲', desc: 'In-editor hooks: scene checks, live capture.', status: 'Coming soon' },
    { name: 'Web / Playwright', icon: '◎', desc: 'Scripted browser input driver for web games — powers scenario replay.', status: 'Coming soon' }
  ];

  const runInit = async () => {
    setBusy(true);
    const res = await bridge.config.generate(initOffer.dir, {});
    setBusy(false);
    if (res?.error && !res.written) return toast(`Init failed: ${res.error}`);
    toast(`Config created — engine ${res.detection.engine} (${res.detection.confidence})`);
    setInitOffer(null);
    connect(initOffer.dir);
  };

  return (
    <div>
      <h2 className="page-title">Connect Ember</h2>
      <p className="page-sub">Wire Ember into your project, builds, logs and tools.</p>

      {project && (
        <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className="chip ok">connected</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{project.config.projectName}</div>
            <div className="micro-mono" style={{ marginTop: 3 }}>{project.root} · {project.config.engine} · detected {project.detection?.engine} ({project.detection?.confidence})</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setModule('run')}>Run tests</button>
          <button className="btn btn-danger btn-sm" onClick={disconnectProject}>Disconnect</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 12 }}>
        {CONNECTORS.map((c, i) => {
          const soon = c.status === 'Coming soon';
          const conn = c.status === 'Connected';
          return (
            <div key={c.name} className="anim-up" style={{
              padding: 18, borderRadius: 14, background: 'rgba(255,255,255,.025)',
              border: `1px solid ${conn ? 'rgba(255,120,60,.3)' : 'rgba(255,255,255,.07)'}`,
              transition: 'all .22s', animationDelay: `${i * 0.04}s`
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--accent-mid)' }}>{c.icon}</span>
                <span className={`chip ${conn ? 'ok' : soon ? 'dim' : 'fire'}`} style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.06em' }}>{c.status}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>{c.name}</div>
              <div style={{ fontSize: 11, lineHeight: 1.55, color: 'rgba(244,244,245,.45)', marginBottom: c.lastSync ? 6 : 14, minHeight: 34 }}>{c.desc}</div>
              {c.lastSync && <div className="micro-mono" style={{ fontSize: 9.5, color: 'var(--ink-faint)', marginBottom: 10 }}>Last sync: {c.lastSync}</div>}
              <button
                className="btn btn-ghost btn-sm"
                style={{ width: '100%', opacity: soon ? 0.55 : 1 }}
                onClick={c.action ?? (() => toast(`${c.name} — coming soon. It will ${c.desc.toLowerCase()}`))}
                disabled={busy}
              >
                {soon ? 'Coming soon' : c.btn}
              </button>
            </div>
          );
        })}
      </div>

      {!project && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="panel-label">Connect by path</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <input className="input mono" style={{ flex: 1 }} placeholder="/path/to/your/game-project" value={pathInput} onChange={(e) => setPathInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && connect(pathInput)} />
            <button className="btn btn-white" disabled={!pathInput || busy} onClick={() => connect(pathInput)}>Connect</button>
          </div>
          {settings.recentProjects.length > 0 && (
            <div className="row-list" style={{ marginTop: 14 }}>
              {settings.recentProjects.map((p) => (
                <div key={p} className="row" onClick={() => connect(p)}>
                  <div className="grow"><div className="meta">{p}</div></div>
                  <span className="chip dim">reconnect</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {initOffer && (
        <div className="card" style={{ marginTop: 16, borderColor: 'rgba(255,120,60,.4)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>No ember.config.json in {initOffer.dir}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 12 }}>Ember can detect the engine and generate one (same as <code>ember init</code>).</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-white btn-sm" disabled={busy} onClick={runInit}>{busy ? 'Generating…' : 'Generate config'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setInitOffer(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
