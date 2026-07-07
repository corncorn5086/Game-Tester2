import { useEffect, useMemo, useState } from 'react';
import { useApp } from './lib/store.jsx';
import logo from './assets/ember-logo.png';
import Splash from './screens/Splash.jsx';
import Auth from './screens/Auth.jsx';
import Onboarding from './screens/Onboarding.jsx';
import CommandCenter from './pages/CommandCenter.jsx';
import Connect from './pages/Connect.jsx';
import Agent from './pages/Agent.jsx';
import Analysis from './pages/Analysis.jsx';
import LiveRun from './pages/LiveRun.jsx';
import Bugs, { BugDrawer } from './pages/Bugs.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import TestPlans from './pages/TestPlans.jsx';
import Team from './pages/Team.jsx';
import Billing from './pages/Billing.jsx';

const DOCK = [
  ['command', 'Center', '◉'],
  ['connect', 'Connect', '⌁'],
  ['agent', 'Agent', '⌘'],
  ['analyze', 'Analyze', '◈'],
  ['run', 'Run', '▶'],
  ['bugs', 'Bugs', '⬡'],
  ['reports', 'Reports', '▤'],
  ['settings', 'Settings', '⚙']
];

const MODULES = {
  command: CommandCenter,
  connect: Connect,
  agent: Agent,
  analyze: Analysis,
  run: LiveRun,
  bugs: Bugs,
  reports: Reports,
  settings: Settings,
  plans: TestPlans,
  team: Team,
  billing: Billing
};

const MODE_PILL = {
  real: ['Real project', 'var(--ok)', 'rgba(52,211,153,.07)', 'rgba(52,211,153,.22)'],
  none: ['Not connected', 'rgba(244,244,245,.35)', 'rgba(255,255,255,.04)', 'rgba(255,255,255,.1)']
};

function Palette({ onClose }) {
  const { setModule, saveSettings, settings, toast } = useApp();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);

  const items = useMemo(() => {
    const nav = [
      ...DOCK.map(([id, label, icon]) => ({ label: `Go to ${label}`, icon, kind: 'nav', go: () => setModule(id) })),
      { label: 'Go to Test Plans', icon: '▣', kind: 'nav', go: () => setModule('plans') },
      { label: 'Go to Team & Share', icon: '◫', kind: 'nav', go: () => setModule('team') },
      { label: 'Go to Billing', icon: '◇', kind: 'nav', go: () => setModule('billing') },
      { label: settings.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme', icon: '◐', kind: 'mode', go: () => saveSettings({ theme: settings.theme === 'light' ? 'dark' : 'light' }) }
    ];
    if (!q) return nav;
    return nav.filter((a) => a.label.toLowerCase().includes(q.toLowerCase()));
  }, [q, setModule, saveSettings, settings.theme, toast]);

  useEffect(() => setSel(0), [q]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Type a command…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, items.length - 1));
            else if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0));
            else if (e.key === 'Enter' && items[sel]) { items[sel].go(); onClose(); }
            else if (e.key === 'Escape') onClose();
          }}
        />
        <div className="list">
          {items.map((a, i) => (
            <button key={a.label} className={`item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => { a.go(); onClose(); }}>
              <span className="icon">{a.icon}</span>
              {a.label}
              <span className="kind">{a.kind}</span>
            </button>
          ))}
          {items.length === 0 && <div style={{ padding: '14px 18px', color: 'var(--ink-faint)', fontSize: 12.5 }}>No matching command.</div>}
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const { module, setModule, mode, project, settings, paletteOpen, setPaletteOpen, selectedBug, setSelectedBug, toastMsg, backendHealth } = useApp();
  const Module = MODULES[module] ?? CommandCenter;
  const [label, color, bg, border] = MODE_PILL[mode] ?? MODE_PILL.none;

  const projectLabel = project ? `${project.config.projectName} — ${project.root}` : 'No project connected';

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="topbar">
        <img className="logo" src={logo} alt="Ember" />
        <div className="name">Ember</div>
        <div className="sep" />
        <div className="proj">{projectLabel}</div>
        <div style={{ flex: 1 }} />
        <span className="micro-mono" style={{ color: backendHealth?.ok ? 'var(--ok)' : 'var(--ink-ghost)' }}>
          {backendHealth == null ? 'cloud: …' : backendHealth.ok ? `cloud v${backendHealth.version}` : 'cloud offline'}
        </span>
        <div className="mode-pill" style={{ background: bg, borderColor: border }}>
          <span className="dot" style={{ background: color }} />
          <span className="txt" style={{ color }}>{label}</span>
        </div>
        <button className="kbtn" onClick={() => setPaletteOpen(true)}>
          ⌘K <span style={{ fontFamily: 'var(--font-body)' }}>Command palette</span>
        </button>
      </div>

      <div key={module} className="module">
        <Module />
      </div>

      <div className="dock">
        {DOCK.map(([id, dlabel, icon]) => (
          <button key={id} className={module === id ? 'on' : ''} title={dlabel} onClick={() => setModule(id)}>
            <span className="d-icon">{icon}</span>
            <span className="d-label">{dlabel}</span>
            <span className="d-dot" />
          </button>
        ))}
      </div>

      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} />}
      {selectedBug && <BugDrawer bug={selectedBug} onClose={() => setSelectedBug(null)} />}
      {toastMsg && <div className="toast-v2">{toastMsg}</div>}
    </div>
  );
}

export default function App() {
  const { phase, setPaletteOpen, setSelectedBug, settingsLoaded } = useApp();

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        setSelectedBug(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaletteOpen, setSelectedBug]);

  return (
    <div className="frame">
      {!settingsLoaded || phase === 'splash' ? <Splash /> : phase === 'auth' ? <Auth /> : phase === 'onboarding' ? <Onboarding /> : <Shell />}
    </div>
  );
}
