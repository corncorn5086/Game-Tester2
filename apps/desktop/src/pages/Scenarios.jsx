import { useState } from 'react';
import { Clapperboard, Plus, PlayCircle, Trash2, Pencil, Save, X, Lock } from 'lucide-react';
import { useApp } from '../lib/store.jsx';
import { bridge } from '../lib/bridge.js';
import { Empty, useProjectGate } from '../components/common.jsx';

/**
 * Scenario Recorder: define named playtest scenarios (steps + expected
 * result), stored for real in ember.config.json. Replay requires an
 * input-injection driver Ember doesn't have yet for any engine, so every
 * scenario is honestly reported as "Requires SDK" instead of faking a run.
 */
const EXAMPLE_SCENARIOS = [
  ['Login flow', ['Launch the game', 'Enter valid credentials', 'Submit the login form'], 'Player reaches the main menu with their profile loaded.'],
  ['Main menu navigation', ['Open the main menu', 'Visit every top-level menu entry', 'Return to the main menu from each'], 'Every menu screen opens and returns without a dead end or crash.'],
  ['Start new game', ['From the main menu, choose New Game', 'Complete any intro/character setup', 'Reach the first playable state'], 'Player gains control in the first level with default state.'],
  ['Save / load cycle', ['Play until a save point', 'Save the game', 'Reload that save'], 'Reloaded state matches the state at the moment of saving.'],
  ['Inventory management', ['Open inventory', 'Add, stack and drop a few items', 'Close and reopen inventory'], 'Item counts and positions persist correctly with no duplication or loss.'],
  ['Combat loop', ['Enter combat with a basic enemy', 'Attack, take damage, use one ability', 'Win or lose the encounter'], 'Combat resolves cleanly with correct health/state transitions.'],
  ['Controller input', ['Connect a gamepad', 'Navigate menus and move the player with it', 'Trigger every mapped action'], 'Every gamepad input registers with no missed or double inputs.']
];

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

  const addExample = async ([name, steps, expectedResult]) => {
    if (scenarios.some((s) => s.name === name)) return toast(`"${name}" is already in this project`);
    const entry = { id: `scn_${Date.now().toString(36)}`, name, steps, expectedResult, createdAt: new Date().toISOString() };
    if (await persist([...scenarios, entry])) toast(`Added "${name}" — edit its steps to match your game`);
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
        Replay requires a scripted-input driver Ember doesn't have for any engine yet, so it's honestly marked <b>Requires SDK</b> rather than faked.
      </p>

      {scenarios.length === 0 && editing === null && (
        <Empty icon={Clapperboard} title="No scenarios recorded yet" body="Create one from scratch, or start from a common example below.">
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
                <span className="chip warn"><Lock size={9} /> Requires SDK</span>
                <button className="btn btn-ghost btn-sm" title="Replay requires an input-injection SDK — coming soon" disabled>
                  <PlayCircle size={13} /> Replay
                </button>
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

      <div style={{ marginTop: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 10 }}>Quick-start examples</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 8 }}>
          {EXAMPLE_SCENARIOS.map((ex) => (
            <button key={ex[0]} className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => addExample(ex)}>
              <Plus size={12} /> {ex[0]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
