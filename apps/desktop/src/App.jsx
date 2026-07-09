import { useEffect, useMemo, useState } from 'react';
import {
  User, Pencil, Lock, ShieldCheck, SlidersHorizontal, Palette as PaletteIcon, Globe, Bell,
  CreditCard, Plug, EyeOff, LifeBuoy, LogOut, Activity,
  ScanLine, AlertTriangle, FileText, CalendarX, Unplug, ServerCrash, DownloadCloud, UserPlus, FileWarning,
  LayoutDashboard, FolderKanban, SearchCode, Play, Bug, Settings as SettingsIcon, FolderOpen
} from 'lucide-react';
import { useApp } from './lib/store.jsx';
import logo from './assets/ember-logo.png';
import Splash from './screens/Splash.jsx';
import Auth from './screens/Auth.jsx';
import Onboarding from './screens/Onboarding.jsx';
import CommandCenter from './pages/CommandCenter.jsx';
import Projects from './pages/Projects.jsx';
import Connect from './pages/Connect.jsx';
import Agent from './pages/Agent.jsx';
import Analysis from './pages/Analysis.jsx';
import LiveRun from './pages/LiveRun.jsx';
import Bugs, { BugDrawer } from './pages/Bugs.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import TestPlans from './pages/TestPlans.jsx';
import Scenarios from './pages/Scenarios.jsx';
import ConfigEditor from './pages/ConfigEditor.jsx';
import Team from './pages/Team.jsx';
import Billing from './pages/Billing.jsx';
import Account from './pages/Account.jsx';
import Diagnostics from './pages/Diagnostics.jsx';

const NAV = [
  ['command', 'Center', LayoutDashboard],
  ['projects', 'Projects', FolderKanban],
  ['analyze', 'Analyze', SearchCode],
  ['run', 'Run', Play],
  ['bugs', 'Bugs', Bug],
  ['reports', 'Reports', FileText],
  ['settings', 'Settings', SettingsIcon]
];

const MODULES = {
  command: CommandCenter,
  projects: Projects,
  connect: Connect,
  agent: Agent,
  analyze: Analysis,
  run: LiveRun,
  bugs: Bugs,
  reports: Reports,
  settings: Settings,
  plans: TestPlans,
  scenarios: Scenarios,
  configEditor: ConfigEditor,
  team: Team,
  billing: Billing,
  account: Account,
  diagnostics: Diagnostics
};

const PROFILE_MENU = [
  ['menu.account', [
    ['menu.profile', User, 'account', 'profile'],
    ['menu.editInfo', Pencil, 'account', 'edit'],
    ['menu.changePassword', Lock, 'account', 'password'],
    ['menu.security', ShieldCheck, 'account', 'security']
  ]],
  ['menu.preferences', [
    ['menu.general', SlidersHorizontal, 'settings', 'General'],
    ['menu.language', Globe, 'settings', 'Language'],
    ['menu.appearance', PaletteIcon, 'settings', 'Appearance'],
    ['menu.notifications', Bell, 'settings', 'Notifications']
  ]],
  ['menu.subscription', [
    ['menu.billing', CreditCard, 'billing', null]
  ]],
  ['menu.system', [
    ['menu.integrations', Plug, 'connect', null],
    ['menu.privacy', EyeOff, 'settings', 'Privacy'],
    ['menu.diagnostics', Activity, 'diagnostics', null],
    ['menu.support', LifeBuoy, 'account', 'support']
  ]]
];

function ProfileMenu() {
  const { user, settings, openModule, logout, setProfileMenuOpen, t } = useApp();
  const name = user?.name || settings.session?.name || 'Account';
  const email = user?.email || settings.authEmail || '';
  const initials = (name || email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  const color = user?.avatarColor || '#ff4d00';

  return (
    <>
      <div className="pmenu-veil" onClick={() => setProfileMenuOpen(false)} />
      <div className="pmenu" onClick={(e) => e.stopPropagation()}>
        <div className="pmenu-head">
          <div className="avatar" style={{ width: 40, height: 40, fontSize: 15, background: color }}>
            {user?.avatarData ? <img src={user.avatarData} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="name">{name}</div>
            <div className="email" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
          </div>
        </div>
        <div className="pmenu-body">
          {PROFILE_MENU.map(([group, items]) => (
            <div className="pmenu-group" key={group}>
              <div className="pmenu-group-label">{t(group)}</div>
              {items.map(([label, Icon, mod, param]) => (
                <button key={label} className="pmenu-item" onClick={() => openModule(mod, param)}>
                  <span className="pm-ic"><Icon size={15} /></span>{t(label)}
                </button>
              ))}
            </div>
          ))}
          <div className="pmenu-group">
            <button className="pmenu-item danger" onClick={logout}>
              <span className="pm-ic"><LogOut size={15} /></span>{t('menu.signout')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const NOTIF_ICON = {
  'scan-completed': ScanLine,
  'critical-bug': AlertTriangle,
  'report-generated': FileText,
  'payment-succeeded': CreditCard,
  'subscription-expired': CalendarX,
  'project-disconnected': Unplug,
  'backend-error': ServerCrash,
  'update-available': DownloadCloud,
  'teammate-invited': UserPlus,
  'import-failed': FileWarning
};

function NotificationBell() {
  const { notifications, notificationsOpen, setNotificationsOpen, markNotificationRead, markAllNotificationsRead, backendHealth } = useApp();
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div style={{ position: 'relative' }}>
      <button className="kbtn" style={{ position: 'relative', padding: '8px 10px' }} onClick={() => setNotificationsOpen((o) => !o)} title="Notifications">
        <Bell size={15} />
        {unread > 0 && <span className="notif-dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {notificationsOpen && (
        <>
          <div className="pmenu-veil" onClick={() => setNotificationsOpen(false)} />
          <div className="pmenu" style={{ width: 340 }} onClick={(e) => e.stopPropagation()}>
            <div className="pmenu-head" style={{ justifyContent: 'space-between' }}>
              <div className="name">Notifications</div>
              {unread > 0 && <button className="auth-link" style={{ fontSize: 11 }} onClick={markAllNotificationsRead}>Mark all read</button>}
            </div>
            <div className="pmenu-body" style={{ maxHeight: 380 }}>
              {!backendHealth?.ok && (
                <div className="sub" style={{ padding: '10px 8px' }}>Backend offline — notifications need the backend to persist.</div>
              )}
              {backendHealth?.ok && notifications.length === 0 && (
                <div className="sub" style={{ padding: '10px 8px' }}>No notifications yet. Scans, reports, critical bugs and payments will appear here.</div>
              )}
              {notifications.map((n) => {
                const Icon = NOTIF_ICON[n.type] ?? Bell;
                return (
                  <button key={n.id} className="pmenu-item" style={{ alignItems: 'flex-start', opacity: n.read ? 0.55 : 1 }} onClick={() => markNotificationRead(n.id)}>
                    <span className="pm-ic" style={{ marginTop: 2 }}><Icon size={15} /></span>
                    <span style={{ flex: 1, textAlign: 'left' }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>{n.title}</div>
                      {n.body && <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 2 }}>{n.body}</div>}
                      <div style={{ fontSize: 9.5, color: 'var(--ink-ghost)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>{new Date(n.createdAt).toLocaleString()}</div>
                    </span>
                    {!n.read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flex: 'none', marginTop: 5 }} />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const MODE_PILL = {
  real: ['Real project', 'var(--ok)', 'rgba(52,211,153,.07)', 'rgba(52,211,153,.22)'],
  none: ['Not connected', 'rgba(244,244,245,.35)', 'rgba(255,255,255,.04)', 'rgba(255,255,255,.1)']
};

/** Subsequence fuzzy match: -1 if query's chars aren't all present in order, else a score (lower = better). */
function fuzzyScore(text, query) {
  if (!query) return 0;
  text = text.toLowerCase();
  query = query.toLowerCase();
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (let qi = 0; qi < query.length; qi++) {
    const idx = text.indexOf(query[qi], ti);
    if (idx === -1) return -1;
    score += (idx - ti) - streak;
    streak = idx === ti ? streak + 1 : 0;
    ti = idx + 1;
  }
  return score;
}

function Palette({ onClose }) {
  const { setModule, saveSettings, settings, openModule } = useApp();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);

  const allItems = useMemo(() => [
    ...NAV.map(([id, label, Icon], i) => ({ label: `Go to ${label}`, icon: Icon, kind: 'nav', shortcut: `⌘${i + 1}`, go: () => setModule(id) })),
    { label: 'Go to Test Plans', icon: '▣', kind: 'nav', go: () => setModule('plans') },
    { label: 'Go to Scenario Recorder', icon: '⌗', kind: 'nav', go: () => setModule('scenarios') },
    { label: 'Go to Config Editor', icon: '{ }', kind: 'nav', go: () => setModule('configEditor') },
    { label: 'Go to Team & Share', icon: '◫', kind: 'nav', go: () => setModule('team') },
    { label: 'Go to Billing', icon: '◇', kind: 'nav', go: () => setModule('billing') },
    { label: 'Go to Account', icon: '◔', kind: 'nav', go: () => setModule('account') },
    { label: 'Go to Diagnostics', icon: '◑', kind: 'nav', go: () => setModule('diagnostics') },
    { label: 'Show keyboard shortcuts', icon: '⌨', kind: 'help', shortcut: '⌘/', go: () => openModule('settings', 'Keyboard shortcuts') },
    { label: settings.density === 'compact' ? 'Switch to comfortable density' : 'Switch to compact density', icon: '▤', kind: 'mode', go: () => saveSettings({ density: settings.density === 'compact' ? 'comfortable' : 'compact' }) }
  ], [setModule, saveSettings, settings.density, openModule]);

  const items = useMemo(() => {
    if (!q) return allItems;
    return allItems
      .map((a) => ({ a, score: fuzzyScore(a.label, q) }))
      .filter((x) => x.score !== -1)
      .sort((x, y) => x.score - y.score)
      .map((x) => x.a);
  }, [q, allItems]);

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
              <span className="icon">{typeof a.icon === 'function' ? <a.icon size={15} /> : a.icon}</span>
              {a.label}
              {a.shortcut && <span className="kbd" style={{ marginLeft: 8 }}>{a.shortcut}</span>}
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
  const { module, setModule, mode, project, settings, user, paletteOpen, setPaletteOpen, selectedBug, setSelectedBug, toastMsg, backendHealth, profileMenuOpen, setProfileMenuOpen, t } = useApp();
  const Module = MODULES[module] ?? CommandCenter;
  const [label, color] = MODE_PILL[mode] ?? MODE_PILL.none;

  const projectLabel = project ? `${project.config.projectName} — ${project.root}` : 'No project connected';
  const avName = user?.name || settings.session?.name || settings.authEmail || 'Account';
  const avInitials = avName.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  const avColor = user?.avatarColor || '#ff4d00';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img className="logo" src={logo} alt="Ember" />
          <span>EMBER</span>
        </div>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {NAV.map(([id, navLabel, Icon]) => (
            <button key={id} className={module === id ? 'on' : ''} onClick={() => setModule(id)}>
              <Icon size={18} strokeWidth={1.8} />
              <span>{t(`nav.${id}`) || navLabel}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <button className="sidebar-connect" onClick={() => setModule('connect')}>
          <FolderOpen size={17} /> {project ? 'Project connection' : 'Connect project'}
        </button>
        <div className="sidebar-status">
          <span className="status-ring" style={{ color }} />
          <div>
            <strong>{label}</strong>
            <span>{project ? project.config.projectName : 'No project connected'}</span>
          </div>
        </div>
      </aside>

      <main className="main-shell">
        <div className="topbar">
          <div>
            <div className="page-context">{NAV.find(([id]) => id === module)?.[1] ?? 'Ember'}</div>
            <div className="proj">{projectLabel}</div>
          </div>
          <div style={{ flex: 1 }} />
          <span className={`health-pill ${backendHealth?.ok ? 'ok' : ''}`}>
            <span className="dot" /> {backendHealth?.ok ? `Backend v${backendHealth.version}` : 'Backend offline'}
          </span>
          <button className="kbtn" onClick={() => setPaletteOpen(true)} title="Open command palette">
            ⌘K <span>Commands</span>
          </button>
          <NotificationBell />
          <button type="button" className="avatar" style={{ background: avColor }} title={avName} aria-label="Open profile menu" onClick={() => setProfileMenuOpen((o) => !o)}>
            {user?.avatarData ? <img src={user.avatarData} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : avInitials}
          </button>
        </div>

        {profileMenuOpen && <ProfileMenu />}

        <div key={module} className="module">
          <Module />
        </div>
      </main>

      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} />}
      {selectedBug && <BugDrawer bug={selectedBug} onClose={() => setSelectedBug(null)} />}
      {toastMsg && <div className="toast-v2">{toastMsg}</div>}
    </div>
  );
}

export default function App() {
  const { phase, setPaletteOpen, setSelectedBug, settingsLoaded, setModule, setModuleParam, setNotificationsOpen, setProfileMenuOpen } = useApp();

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        setSelectedBug(null);
        setNotificationsOpen(false);
        setProfileMenuOpen(false);
        return;
      }
      if (phase !== 'app') return;
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setModule('settings');
        setModuleParam('Keyboard shortcuts');
        return;
      }
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        const target = NAV[Number(e.key) - 1];
        if (target) {
          e.preventDefault();
          setModule(target[0]);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, setPaletteOpen, setSelectedBug, setModule, setModuleParam, setNotificationsOpen, setProfileMenuOpen]);

  return (
    <div className="frame">
      {!settingsLoaded || phase === 'splash' ? <Splash /> : phase === 'auth' ? <Auth /> : phase === 'onboarding' ? <Onboarding /> : <Shell />}
    </div>
  );
}
