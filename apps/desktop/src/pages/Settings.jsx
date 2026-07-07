import { useEffect, useRef, useState } from 'react';
import { ENGINE_KEYS, ENGINES } from '@ember/shared/engines';
import { useApp } from '../lib/store.jsx';
import { bridge } from '../lib/bridge.js';
import { SettingRow, Toggle } from '../components/common.jsx';
import { DEFAULT_SETTINGS } from '../lib/store.jsx';

const ACCENTS = ['#ff4d00', '#ff8a50', '#ffd27a', '#34d399', '#93c5fd', '#c58bff'];

/** Settings (v2): collapsible sections, all values persisted for real. */
export default function Settings() {
  const { settings, saveSettings, toast, setPhase, setModule, api, backendHealth } = useApp();
  const [open, setOpen] = useState({ General: true });
  const [aiStatus, setAiStatus] = useState(null);
  const importRef = useRef(null);
  const S = settings;

  useEffect(() => {
    bridge.agent.aiStatus(S.aiProvider).then(setAiStatus);
  }, [S.aiProvider]);
  const set = (k) => (v) => saveSettings({ [k]: v });
  const input = (k, props = {}) => (
    <input className="input" value={S[k] ?? ''} onChange={(e) => saveSettings({ [k]: props.type === 'number' ? Number(e.target.value) : e.target.value })} {...props} />
  );

  const toggleSec = (name) => setOpen((o) => ({ ...o, [name]: !o[name] }));

  const exportSettings = async () => {
    const { authToken, ...safe } = S;
    const f = await bridge.file.saveAs({ title: 'Export settings', defaultPath: 'ember-settings.json', content: JSON.stringify(safe, null, 2) });
    if (f) toast(`Settings exported — ${f}`);
  };

  const importSettings = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { authToken, ...safe } = JSON.parse(String(reader.result));
        saveSettings(safe);
        toast(`Settings imported — ${Object.keys(safe).length} keys`);
      } catch (err) {
        toast(`Import failed: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const logout = async () => {
    if (S.authToken) api.logout().catch(() => {});
    await saveSettings({ session: null, authToken: '', authEmail: '' });
    setPhase('auth');
  };

  const Section = ({ name, icon, children }) => (
    <div className={`collapse ${open[name] ? 'open' : ''}`}>
      <button onClick={() => toggleSec(name)}>
        <span className="c-icon">{icon}</span>
        <span className="c-name">{name}</span>
        <span className="c-chev">▾</span>
      </button>
      {open[name] && <div className="c-body">{children}</div>}
    </div>
  );

  return (
    <div>
      <h2 className="page-title" style={{ marginBottom: 18 }}>Settings</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 760 }}>
        <Section name="General" icon="⚙">
          <SettingRow name="Language" desc="More locales coming; reports are language-neutral JSON/Markdown.">
            <select className="input" value={S.language} onChange={(e) => saveSettings({ language: e.target.value })}>
              <option value="en">English</option>
              <option value="fr">Français (soon)</option>
            </select>
          </SettingRow>
          <SettingRow name="Default project folder" desc="Starting point for the folder picker.">{input('defaultProjectFolder', { placeholder: 'C:/Projects' })}</SettingRow>
          <SettingRow name="Default report folder" desc="Export destination.">{input('defaultReportFolder', { placeholder: 'C:/Projects/reports' })}</SettingRow>
          <SettingRow name="Preferred engine" desc="Pre-selected in onboarding and ember init.">
            <select className="input" value={S.preferredEngine} onChange={(e) => saveSettings({ preferredEngine: e.target.value })}>
              <option value="auto">Auto-detect</option>
              {ENGINE_KEYS.map((k) => <option key={k} value={k}>{ENGINES[k].label}</option>)}
            </select>
          </SettingRow>
        </Section>

        <Section name="Appearance" icon="◐">
          <SettingRow name="Theme" desc="Ember Graphite (dark) is the default.">
            <select className="input" value={S.theme} onChange={(e) => saveSettings({ theme: e.target.value })}>
              <option value="dark">Ember Graphite</option>
              <option value="light">Light</option>
            </select>
          </SettingRow>
          <SettingRow name="Accent color" desc="Used across active states.">
            <div style={{ display: 'flex', gap: 7 }}>
              {ACCENTS.map((c) => (
                <button key={c} onClick={() => saveSettings({ accentColor: c })} style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', border: S.accentColor === c ? '2px solid #fff' : '2px solid transparent' }} />
              ))}
            </div>
          </SettingRow>
          <SettingRow name="Animation intensity" desc="Reduce for low-power machines.">
            <select className="input" value={S.animationIntensity} onChange={(e) => saveSettings({ animationIntensity: e.target.value })}>
              <option value="full">Full</option>
              <option value="reduced">Reduced</option>
            </select>
          </SettingRow>
          <SettingRow name="Keyboard shortcuts" desc="⌘K command palette · Esc closes overlays">
            <span className="kbd">⌘K</span>
          </SettingRow>
        </Section>

        <Section name="Agent & Analysis" icon="⌘">
          <SettingRow name="Local agent path" desc="Custom path to the ember CLI (blank = bundled agent core).">{input('agentPath', { placeholder: 'auto (bundled)' })}</SettingRow>
          <SettingRow name="Scan mode" desc="Deep reads every source file; quick caps at 1,000 files.">
            <select className="input" value={S.scanMode} onChange={(e) => saveSettings({ scanMode: e.target.value })}>
              <option value="deep">Deep scan</option>
              <option value="quick">Quick scan</option>
            </select>
          </SettingRow>
          <SettingRow name="Max files to scan" desc="Per-scan cap (also set per project in ember.config.json).">{input('maxFilesToAnalyze', { type: 'number', style: { width: 110 } })}</SettingRow>
          <SettingRow name="Included extensions" desc="Blank = engine defaults.">{input('includeExtensions', { placeholder: '.cs .cpp .gd .js .ts' })}</SettingRow>
          <SettingRow name="Ignored folders" desc="Merged with per-project ignorePaths.">{input('ignoreFolders')}</SettingRow>
        </Section>

        <Section name="AI" icon="✦">
          <SettingRow name="Provider" desc="Auto tries Claude Fable 5 first, then falls back to OpenAI if it fails (e.g. no credit). Keys are set in .env (ANTHROPIC_API_KEY / OPENAI_API_KEY).">
            <select className="input" value={S.aiProvider} onChange={(e) => saveSettings({ aiProvider: e.target.value })}>
              <option value="auto">Auto</option>
              <option value="claude">Claude Fable 5</option>
              <option value="openai">OpenAI</option>
            </select>
          </SettingRow>
          <SettingRow
            name="Status"
            desc={aiStatus?.enabled
              ? `Used for bug explanations and report AI summaries.${aiStatus.fallback?.length ? ` Falls back to ${aiStatus.fallback.map((p) => (p === 'claude' ? 'Claude Fable 5' : 'OpenAI')).join(', ')} if unavailable.` : ''}`
              : (aiStatus?.reason ?? 'Checking…')}
          >
            <span className={`chip ${aiStatus?.enabled ? 'ok' : 'err'}`}>
              {aiStatus?.enabled ? `enabled — ${aiStatus.label} (${aiStatus.model})` : 'not configured'}
            </span>
          </SettingRow>
        </Section>

        <Section name="Backend & Account" icon="⌁">
          <SettingRow name="Backend URL" desc="Ember API for sync, team and billing.">{input('backendUrl')}</SettingRow>
          <SettingRow name="Health" desc="Live status of the configured backend.">
            <span className={`chip ${backendHealth?.ok ? 'ok' : 'err'}`}>
              {backendHealth?.ok ? `healthy v${backendHealth.version}` : 'offline'}
            </span>
          </SettingRow>
          <SettingRow name="Cloud sync" desc="Push runs/reports to your workspace (Supabase-backed).">
            <Toggle on={S.cloudSync} onChange={set('cloudSync')} />
          </SettingRow>
          <SettingRow name="Session" desc={S.session ? `${S.session.name} · ${S.session.ws} (${S.session.kind})` : 'No session'}>
            <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
          </SettingRow>
          <SettingRow name="Team & billing" desc="Workspace members, roles, plans and Stripe placeholders.">
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setModule('team')}>Team</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setModule('billing')}>Billing</button>
            </div>
          </SettingRow>
        </Section>

        <Section name="Privacy" icon="◇">
          <SettingRow name="Do not upload code" desc="Sync sends only metrics and findings — never file contents.">
            <Toggle on={S.doNotUploadCode} onChange={set('doNotUploadCode')} />
          </SettingRow>
          <SettingRow name="Mask secrets in logs" desc="API keys, tokens and JWTs redacted before storage — always on in reports.">
            <Toggle on={S.maskSecrets} onChange={set('maskSecrets')} />
          </SettingRow>
          <SettingRow name="Privacy mode" desc="Strip absolute paths and usernames from exports.">
            <Toggle on={S.privacyMode} onChange={set('privacyMode')} />
          </SettingRow>
          <SettingRow name="Data retention (days)" desc="Local run/report history beyond this is pruned (0 = keep forever).">{input('dataRetentionDays', { type: 'number', style: { width: 110 } })}</SettingRow>
          <SettingRow name="Clear local cache" desc="Empties the recent-projects list (project .ember folders untouched).">
            <button className="btn btn-danger btn-sm" onClick={() => { saveSettings({ recentProjects: [] }); toast('Cache cleared'); }}>Clear</button>
          </SettingRow>
        </Section>

        <Section name="Exports" icon="▤">
          <SettingRow name="Default format" desc="Report export format.">
            <select className="input" value={S.exportFormat} onChange={(e) => saveSettings({ exportFormat: e.target.value })}>
              <option value="json+md">JSON + Markdown</option>
              <option value="json">JSON</option>
              <option value="md">Markdown</option>
              <option value="pdf" disabled>PDF (planned)</option>
            </select>
          </SettingRow>
          <SettingRow name="Include parsed logs" desc="Attach log excerpts to exports.">
            <Toggle on={S.exportIncludeLogs} onChange={set('exportIncludeLogs')} />
          </SettingRow>
          <SettingRow name="Include evidence" desc="Code snippets and traces in exports.">
            <Toggle on={S.exportIncludeEvidence} onChange={set('exportIncludeEvidence')} />
          </SettingRow>
          <SettingRow name="Export settings" desc="Tokens and secrets are never included.">
            <button className="btn btn-ghost btn-sm" onClick={exportSettings}>Export</button>
          </SettingRow>
          <SettingRow name="Import settings">
            <>
              <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={importSettings} />
              <button className="btn btn-ghost btn-sm" onClick={() => importRef.current?.click()}>Import…</button>
            </>
          </SettingRow>
          <SettingRow name="Reset to defaults" desc="Keeps your session and recent projects.">
            <button className="btn btn-danger btn-sm" onClick={() => { saveSettings({ ...DEFAULT_SETTINGS, session: S.session, onboarded: S.onboarded, recentProjects: S.recentProjects }); toast('Settings reset'); }}>Reset</button>
          </SettingRow>
        </Section>
      </div>
    </div>
  );
}
