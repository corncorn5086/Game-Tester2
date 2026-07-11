import { useState } from 'react';
import { Clapperboard, Plus, Trash2, Pencil, Save, X } from 'lucide-react';
import { useApp } from '../lib/store.jsx';
import { bridge } from '../lib/bridge.js';
import { Empty, useProjectGate } from '../components/common.jsx';

/**
 * Scenario Recorder: define named playtest scenarios (steps + expected
 * result), stored for real in ember.config.json.
 */

function StepEditor({ steps, setSteps }) {
  const update = (i, v) => setSteps(steps.map((s, idx) => (idx === i ? v : s)));
  const remove = (i) => setSteps(steps.filter((_, idx) => idx !== i));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="micro-mono" style={{ width: 18, flexShrink: 0 }}>{i + 1}.</span>
          <input className="input" style={{ flex: 1 }} value={s} onChange={(e) => update(i, e.target.value)} placeholder={`Step ${i + 1}…`} />
          <button className="btn btn-ghost btn-sm" onClick={() => remove(i)}><X size={12} /></button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setSteps([...steps, ''])}><Plus size={12} /> Add step</button>
    </div>
  );
}

function ScenarioBuilder({ existing, onSave, onCancel }) {
  const [name, setName] = useState(existing?.name ?? '');
  const [steps, setSteps] = useState(existing?.steps?.length ? existing.steps : ['']);
  const [expectedResult, setExpectedResult] = useState(existing?.expectedResult ?? '');

  const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);
  const canSave = name.trim() && cleanSteps.length > 0 && expectedResult.trim();

  return (
    <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 14, padding: 18, marginTop: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>{existing ? `Edit "${existing.name}"` : 'New scenario'}</div>
      <div className="field">
        <label>Scenario name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Login flow, Save/load cycle…" />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Steps</label>
        <StepEditor steps={steps} setSteps={setSteps} />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Expected result</label>
        <textarea className="input" style={{ minHeight: 60 }} value={expectedResult} onChange={(e) => setExpectedResult(e.target.value)} placeholder="What should be true if this scenario passes?" />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn btn-fire btn-sm" disabled={!canSave} onClick={() => onSave({ name: name.trim(), steps: cleanSteps, expectedResult: expectedResult.trim() })}>
          <Save size={13} /> Save scenario
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function Scenarios() {
  const { gate, project } = useProjectGate();
  const { setProject, toast } = useApp();
  const [editing, setEditing] = useState(null); // null | 'new' | scenario id

  if (gate) return gate;

  const scenarios = project.config.scenarios ?? [];

  const persist = async (next) => {
    const nextConfig = { ...project.config, scenarios: next };
    const res = await bridge.config.write(project.configPath, nextConfig);
    if (res?.error) return toast(`Save failed: ${res.error}`);
    setProject({ ...project, config: nextConfig });
    return true;
  };

  const saveScenario = async (data) => {
    const id = editing === 'new' ? `scn_${Date.now().toString(36)}` : editing;
    const existingIdx = scenarios.findIndex((s) => s.id === id);
    const entry = { id, ...data, createdAt: existingIdx >= 0 ? scenarios[existingIdx].createdAt : new Date().toISOString() };
    const next = existingIdx >= 0 ? scenarios.map((s, i) => (i === existingIdx ? entry : s)) : [...scenarios, entry];
    if (await persist(next)) {
      toast(`Scenario "${data.name}" saved`);
      setEditing(null);
    }
  };

  const removeScenario = async (id) => {
    const s = scenarios.find((x) => x.id === id);
    if (await persist(scenarios.filter((x) => x.id !== id))) toast(`Scenario "${s?.name}" removed`);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '6px 0 6px' }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: '-.02em' }}>Scenario Recorder</h2>
        <span className="micro-mono">{scenarios.length} scenario(s)</span>
        <div style={{ flex: 1 }} />
        {editing === null && <button className="btn btn-fire btn-sm" onClick={() => setEditing('new')}><Plus size={14} /> New scenario</button>}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-faint)', maxWidth: 640, margin: '0 0 18px' }}>
        Define named playtest scenarios — steps and an expected result — stored in this project's <code style={{ fontSize: 11.5 }}>ember.config.json</code>.
      </p>

      {scenarios.length === 0 && editing === null && (
        <Empty icon={Clapperboard} title="No scenarios recorded yet" body="Create a scenario with the exact steps and expected result for your game.">
          <button className="btn btn-white" onClick={() => setEditing('new')}>New scenario</button>
        </Empty>
      )}

      {scenarios.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {scenarios.map((s) => (
            <div key={s.id} style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Clapperboard size={15} color="var(--accent-soft)" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>{s.steps.length} step(s)</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(s.id)}><Pencil size={12} /></button>
                <button className="btn btn-danger btn-sm" onClick={() => removeScenario(s.id)}><Trash2 size={12} /></button>
              </div>
              {editing !== s.id && (
                <div style={{ marginTop: 10, paddingLeft: 25, fontSize: 11.5, color: 'var(--ink-dim)' }}>
                  <div className="micro-mono" style={{ marginBottom: 4 }}>Expected: {s.expectedResult}</div>
                </div>
              )}
              {editing === s.id && <ScenarioBuilder existing={s} onSave={saveScenario} onCancel={() => setEditing(null)} />}
            </div>
          ))}
        </div>
      )}

      {editing === 'new' && <ScenarioBuilder onSave={saveScenario} onCancel={() => setEditing(null)} />}

    </div>
  );
}
