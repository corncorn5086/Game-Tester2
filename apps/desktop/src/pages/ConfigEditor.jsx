import { useEffect, useState } from 'react';
import { Save, RotateCcw, CheckCircle2, Copy, Plus, Trash2 } from 'lucide-react';
import { ENGINE_KEYS, ENGINES } from '@ember/shared/engines';
import { validateConfig } from '@ember/shared/config-schema';
import { useApp } from '../lib/store.jsx';
import { bridge } from '../lib/bridge.js';
import { useProjectGate } from '../components/common.jsx';

const TABS = ['General', 'Engine', 'Paths', 'Commands', 'Test Profiles', 'Custom Rules', 'Advanced'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];

function ArrayField({ label, hint, value, onChange }) {
  return (
    <div className="field">
      <label>{label}</label>
      <textarea
        className="input mono"
        style={{ minHeight: 70, fontSize: 12 }}
        value={(value ?? []).join('\n')}
        onChange={(e) => onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
        placeholder={hint}
      />
    </div>
  );
}

export default function ConfigEditor() {
  const { gate, project } = useProjectGate();
  const { setProject, toast, setModule } = useApp();
  const [draft, setDraft] = useState(project?.config ?? null);
  const [loadedFor, setLoadedFor] = useState(project?.configPath ?? null);
  const [tab, setTab] = useState('General');
  const [errors, setErrors] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (project && project.configPath !== loadedFor) {
      setDraft(project.config);
      setLoadedFor(project.configPath);
      setErrors(null);
    }
  }, [project, loadedFor]);

  if (gate) return gate;
  if (draft === null || project.configPath !== loadedFor) return null;

  const set = (patch) => setDraft({ ...draft, ...patch });
  const dirty = JSON.stringify(draft) !== JSON.stringify(project.config);

  const runValidate = () => {
    const v = validateConfig(draft);
    setErrors(v);
    toast(v.valid ? 'Config is valid' : `${v.errors.length} error(s) — see below`);
    return v;
  };

  const save = async () => {
    const v = runValidate();
    if (!v.valid) return;
    setBusy(true);
    const res = await bridge.config.write(project.configPath, draft);
    setBusy(false);
    if (res?.error) return toast(`Save failed: ${res.error}`);
    setProject({ ...project, config: draft });
    toast('ember.config.json saved');
  };

  const reset = () => {
    setDraft(project.config);
    setErrors(null);
    toast('Reverted to the saved config');
  };

  const setCustomRule = (i, patch) => {
    const next = [...(draft.customRules ?? [])];
    next[i] = { ...next[i], ...patch };
    set({ customRules: next });
  };
  const addCustomRule = () => set({ customRules: [...(draft.customRules ?? []), { id: `rule-${(draft.customRules?.length ?? 0) + 1}`, pattern: '', message: '', severity: 'medium', category: 'custom', extensions: [] }] });
  const removeCustomRule = (i) => set({ customRules: (draft.customRules ?? []).filter((_, idx) => idx !== i) });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0 16px' }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: '-.02em' }}>Config Editor</h2>
        <span className="micro-mono">{project.configPath}</span>
        {dirty && <span className="chip warn">unsaved changes</span>}
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" disabled={!dirty} onClick={reset}><RotateCcw size={13} /> Reset</button>
        <button className="btn btn-ghost btn-sm" onClick={runValidate}><CheckCircle2 size={13} /> Validate</button>
        <button className="btn btn-fire btn-sm" disabled={!dirty || busy} onClick={save}><Save size={13} /> {busy ? 'Saving…' : 'Save'}</button>
      </div>

      {errors && (
        <div className={`card ${errors.valid ? '' : ''}`} style={{ marginBottom: 16, borderColor: errors.valid ? 'rgba(52,211,153,.4)' : 'rgba(239,68,68,.4)' }}>
          {errors.valid
            ? <div style={{ fontSize: 12.5, color: 'var(--ok)' }}>Config is valid — no schema errors.</div>
            : (
              <div>
                {errors.errors.map((e, i) => <div key={i} style={{ fontSize: 12, color: 'var(--err)', marginBottom: 4 }}>{e}</div>)}
              </div>
            )}
          {errors.warnings?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {errors.warnings.map((w, i) => <div key={i} style={{ fontSize: 11.5, color: 'var(--warn)' }}>{w}</div>)}
            </div>
          )}
        </div>
      )}

      <div className="seg" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
        {TABS.map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      {tab === 'General' && (
        <div className="grid g2">
          <div className="field"><label>Project name</label><input className="input" value={draft.projectName ?? ''} onChange={(e) => set({ projectName: e.target.value })} /></div>
          <div className="field"><label>Game path</label><input className="input mono" value={draft.gamePath ?? ''} onChange={(e) => set({ gamePath: e.target.value })} /></div>
          <div className="field"><label>Max files per scan</label><input className="input" type="number" min="1" value={draft.maxFiles ?? 5000} onChange={(e) => set({ maxFiles: Number(e.target.value) || 5000 })} /></div>
          <div className="field"><label>Config version</label><input className="input mono" value={draft.configVersion ?? 1} disabled /></div>
        </div>
      )}

      {tab === 'Engine' && (
        <div className="grid g2">
          <div className="field">
            <label>Engine</label>
            <select className="input" value={draft.engine ?? 'custom'} onChange={(e) => set({ engine: e.target.value })}>
              {ENGINE_KEYS.map((k) => <option key={k} value={k}>{ENGINES[k].label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Auto-detected</label>
            <input className="input mono" disabled value={project.detection ? `${project.detection.engine} (${project.detection.confidence})` : '—'} />
          </div>
        </div>
      )}

      {tab === 'Paths' && (
        <div className="grid g2">
          <ArrayField label="Source paths" hint="Assets/Scripts" value={draft.sourcePaths} onChange={(v) => set({ sourcePaths: v })} />
          <ArrayField label="Ignore paths" hint="Library, Temp, .git" value={draft.ignorePaths} onChange={(v) => set({ ignorePaths: v })} />
          <ArrayField label="Include extensions" hint=".cs, .json" value={draft.includeExtensions} onChange={(v) => set({ includeExtensions: v })} />
          <ArrayField label="Exclude extensions" hint=".meta, .png" value={draft.excludeExtensions} onChange={(v) => set({ excludeExtensions: v })} />
          <div className="field"><label>Logs path</label><input className="input mono" value={draft.logsPath ?? ''} onChange={(e) => set({ logsPath: e.target.value })} /></div>
          <div className="field"><label>Screenshots path</label><input className="input mono" value={draft.screenshotsPath ?? ''} onChange={(e) => set({ screenshotsPath: e.target.value })} /></div>
          <div className="field"><label>Crash reports path</label><input className="input mono" value={draft.crashReportsPath ?? ''} onChange={(e) => set({ crashReportsPath: e.target.value })} /></div>
        </div>
      )}

      {tab === 'Commands' && (
        <div className="grid g2">
          <div className="field"><label>Build command</label><input className="input mono" value={draft.buildCommand ?? ''} onChange={(e) => set({ buildCommand: e.target.value })} placeholder="npm run build" /></div>
          <div className="field"><label>Launch command</label><input className="input mono" value={draft.launchCommand ?? ''} onChange={(e) => set({ launchCommand: e.target.value })} placeholder="./build/Game.exe" /></div>
          <div className="field"><label>Test command</label><input className="input mono" value={draft.testCommand ?? ''} onChange={(e) => set({ testCommand: e.target.value })} placeholder="npm run test" /></div>
        </div>
      )}

      {tab === 'Test Profiles' && (
        <div className="card flat">
          <div style={{ fontSize: 13, marginBottom: 10 }}>{Object.keys(draft.testProfiles ?? {}).length} profile(s) configured: {Object.keys(draft.testProfiles ?? {}).join(', ') || 'none'}</div>
          <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginBottom: 12 }}>Test profiles have their own builder — checks, commands, run wiring — in the Test Plans page.</p>
          <button className="btn btn-ghost btn-sm" onClick={() => setModule('plans')}>Open Test Plans</button>
        </div>
      )}

      {tab === 'Custom Rules' && (
        <div>
          {(draft.customRules ?? []).map((r, i) => (
            <div key={i} className="card" style={{ marginBottom: 10 }}>
              <div className="grid g2">
                <div className="field"><label>Rule ID</label><input className="input mono" value={r.id ?? ''} onChange={(e) => setCustomRule(i, { id: e.target.value })} /></div>
                <div className="field"><label>Severity</label>
                  <select className="input" value={r.severity ?? 'medium'} onChange={(e) => setCustomRule(i, { severity: e.target.value })}>
                    {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="field" style={{ gridColumn: '1 / -1' }}><label>Pattern (regex)</label><input className="input mono" value={r.pattern ?? ''} onChange={(e) => setCustomRule(i, { pattern: e.target.value })} /></div>
                <div className="field" style={{ gridColumn: '1 / -1' }}><label>Message</label><input className="input" value={r.message ?? ''} onChange={(e) => setCustomRule(i, { message: e.target.value })} /></div>
                <div className="field"><label>Category</label><input className="input" value={r.category ?? ''} onChange={(e) => setCustomRule(i, { category: e.target.value })} /></div>
                <div className="field"><label>Extensions</label><input className="input mono" value={(r.extensions ?? []).join(', ')} onChange={(e) => setCustomRule(i, { extensions: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></div>
              </div>
              <button className="btn btn-danger btn-sm" style={{ marginTop: 10 }} onClick={() => removeCustomRule(i)}><Trash2 size={12} /> Remove rule</button>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={addCustomRule}><Plus size={13} /> Add custom rule</button>
        </div>
      )}

      {tab === 'Advanced' && (
        <div>
          <div className="grid g2" style={{ marginBottom: 16 }}>
            <div className="field"><label>Backend URL</label><input className="input mono" value={draft.backend?.url ?? ''} onChange={(e) => set({ backend: { ...draft.backend, url: e.target.value } })} placeholder="http://localhost:4310" /></div>
            <div className="field"><label>Backend project ID</label><input className="input mono" value={draft.backend?.projectId ?? ''} onChange={(e) => set({ backend: { ...draft.backend, projectId: e.target.value } })} /></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div className="panel-label" style={{ margin: 0 }}>JSON preview</div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(JSON.stringify(draft, null, 2)).then(() => toast('Config JSON copied'))}><Copy size={12} /> Copy</button>
          </div>
          <pre className="input mono" style={{ maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 11 }}>{JSON.stringify(draft, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
