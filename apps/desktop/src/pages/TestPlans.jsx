import { useState } from 'react';
import { FlaskConical, Plus, PlayCircle, Trash2, Save } from 'lucide-react';
import { CHECK_TYPES } from '@ember/shared/checks';
import { useApp } from '../lib/store.jsx';
import { bridge } from '../lib/bridge.js';
import { useProjectGate } from '../components/common.jsx';

const KIND_LABEL = {
  agent: ['runs today', 'ok'],
  command: ['needs a configured command', 'warn'],
  integration: ['requires engine SDK — reported as blocked', 'err']
};

function PlanBuilder({ onSave, existing }) {
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [checks, setChecks] = useState(new Set(existing?.checks ?? ['scan', 'analyze', 'logs']));
  const [commands, setCommands] = useState((existing?.commands ?? []).join('\n'));

  const toggle = (id) => {
    const next = new Set(checks);
    next.has(id) ? next.delete(id) : next.add(id);
    setChecks(next);
  };

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h3><Plus size={15} color="var(--accent-soft)" /> {existing ? `Edit "${existing.name}"` : 'New test plan'}</h3>
      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="field">
          <label>Plan name</label>
          <input className="input" value={name} placeholder="nightly, pre-release, save-system…" onChange={(e) => setName(e.target.value.replace(/[^\w-]/g, '-'))} />
        </div>
        <div className="field">
          <label>Description</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
        {CHECK_TYPES.map((c) => {
          const [note, cls] = KIND_LABEL[c.kind];
          const on = checks.has(c.id);
          return (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              title={c.description}
              style={{
                textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 12.5,
                border: `1px solid ${on ? 'rgba(255,140,60,0.5)' : 'var(--line)'}`,
                background: on ? 'rgba(255,122,26,0.09)' : 'var(--panel)', color: 'var(--ink)'
              }}
            >
              <div style={{ fontWeight: 700 }}>{on ? '● ' : '○ '}{c.label}</div>
              <div style={{ marginTop: 3 }}><span className={`tag ${cls}`} style={{ fontSize: 10 }}>{note}</span></div>
            </button>
          );
        })}
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label>Extra commands (one per line — executed in the project root)</label>
        <textarea className="input mono" style={{ minHeight: 70, fontSize: 12 }} value={commands} onChange={(e) => setCommands(e.target.value)} placeholder="npm run test:integration" />
      </div>
      <button
        className="btn btn-primary btn-sm"
        style={{ marginTop: 14 }}
        disabled={!name || checks.size === 0}
        onClick={() => onSave({ name, description, checks: [...checks], commands: commands.split('\n').map((s) => s.trim()).filter(Boolean) })}
      >
        <Save size={14} /> Save plan to ember.config.json
      </button>
    </div>
  );
}

export default function TestPlans() {
  const { gate, project } = useProjectGate();
  const { setProject, setModule, toast } = useApp();
  const [editing, setEditing] = useState(null); // null | 'new' | profile name

  if (gate) return gate;

  const profiles = project.config.testProfiles ?? {};

  const savePlan = async (plan) => {
    const nextConfig = {
      ...project.config,
      testProfiles: {
        ...profiles,
        [plan.name]: { description: plan.description, checks: plan.checks, commands: plan.commands }
      }
    };
    const res = await bridge.config.write(project.configPath, nextConfig);
    if (res?.error) return toast('Save failed', res.error, 'err');
    setProject({ ...project, config: nextConfig });
    setEditing(null);
    toast('Test plan saved', `Profile "${plan.name}" written to ember.config.json`, 'ok');
  };

  const removePlan = async (name) => {
    const next = { ...profiles };
    delete next[name];
    const nextConfig = { ...project.config, testProfiles: next };
    const res = await bridge.config.write(project.configPath, nextConfig);
    if (res?.error) return toast('Delete failed', res.error, 'err');
    setProject({ ...project, config: nextConfig });
    toast('Test plan removed', name, 'ok');
  };

  return (
    <div>
      <div className="toolbar">
        <span style={{ fontSize: 13, color: 'var(--ink-dim)' }}>
          Plans live in <code style={{ fontSize: 12 }}>ember.config.json → testProfiles</code> — the CLI runs the same plans (<code style={{ fontSize: 12 }}>ember run --profile name</code>).
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}><Plus size={14} /> New plan</button>
      </div>

      <div className="row-list">
        {Object.entries(profiles).map(([name, p]) => (
          <div key={name} className="row" style={{ cursor: 'default' }}>
            <FlaskConical size={16} color="var(--accent-soft)" />
            <div className="grow">
              <div className="title">{name}</div>
              <div className="meta">{p.description || 'no description'} · {p.checks?.length ?? 0} checks{p.commands?.length ? ` · ${p.commands.length} command(s)` : ''}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {(p.checks ?? []).map((c) => {
                  const check = CHECK_TYPES.find((x) => x.id === c);
                  const cls = check ? { agent: 'ok', command: 'warn', integration: 'err' }[check.kind] : '';
                  return <span key={c} className={`tag ${cls}`} style={{ fontSize: 10 }}>{c}</span>;
                })}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(name)}>Edit</button>
            <button className="btn btn-primary btn-sm" onClick={() => setModule("run")}><PlayCircle size={13} /> Run</button>
            <button className="btn btn-danger btn-sm" onClick={() => removePlan(name)}><Trash2 size={13} /></button>
          </div>
        ))}
        {Object.keys(profiles).length === 0 && (
          <div className="card flat" style={{ fontSize: 13, color: 'var(--ink-dim)' }}>
            No test profiles in this config yet — create one below.
          </div>
        )}
      </div>

      {editing && (
        <PlanBuilder
          existing={editing === 'new' ? null : { name: editing, ...profiles[editing] }}
          onSave={savePlan}
        />
      )}
    </div>
  );
}
