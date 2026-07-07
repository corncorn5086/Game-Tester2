import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../lib/store.jsx';
import { bridge } from '../lib/bridge.js';
import { useProjectGate } from '../components/common.jsx';

/**
 * Live Run (v2): missing-requirements guard, streaming console with sweep,
 * steps tracker and live issue pulses — all fed by real agent steps over IPC.
 */
export default function LiveRun() {
  const { gate, project } = useProjectGate();
  const { lastRun, setLastRun, toast, setModule, logActivity } = useApp();
  const [profile, setProfile] = useState('smoke');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const consoleRef = useRef(null);

  useEffect(() => {
    const off = bridge.agent.onRunStep((step) => setSteps((s) => [...s.slice(-400), step]));
    return off;
  }, []);

  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight });
  }, [steps]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  const profiles = Object.keys(project?.config?.testProfiles ?? {});
  const planChecks = project?.config?.testProfiles?.[profile]?.checks ?? [];

  const missing = useMemo(() => {
    if (!project) return ['Missing project connection', 'Missing ember.config.json'];
    const items = [];
    if (profiles.length === 0) items.push('No testProfiles in ember.config.json — create one in Test Plans');
    if (!project.config.logsPath) items.push('Missing logs folder (optional — evidence will be limited)');
    if (!project.config.buildCommand && !project.config.testCommand) items.push('No buildCommand/testCommand — command checks will be blocked');
    return items;
  }, [project, profiles.length]);

  if (gate) return gate;

  const start = async () => {
    setRunning(true);
    setSteps([]);
    setElapsed(0);
    const run = await bridge.agent.run(project.root, profile);
    setRunning(false);
    if (run?.error) return toast(run.error);
    setLastRun(run);
    logActivity(run.status === 'completed' ? '✓' : '✗', run.status === 'completed' ? 'var(--ok)' : 'var(--err)', `Run "${profile}" ${run.status} — ${run.checksPassed} passed, ${run.checksFailed} failed`);
    toast(`Run ${run.status} — ${run.checksPassed} passed · ${run.checksFailed} failed · ${run.checksBlocked} blocked`);
  };

  const displaySteps = steps;
  const liveIssues = displaySteps.filter((s) => s.type === 'failed');
  const stepState = planChecks.map((check) => {
    const entries = displaySteps.filter((s) => s.check === check);
    const last = entries[entries.length - 1];
    return {
      label: check,
      state: !last ? 'pending' : last.type === 'running' || last.type === 'output' ? 'active' : last.type
    };
  });
  const doneCount = stepState.filter((s) => ['done', 'failed', 'blocked'].includes(s.state)).length;

  const clsFor = (t) => ({ done: 't-ok', failed: 't-err', blocked: 't-warn', running: 't-acc', output: 't-dim', error: 't-err', start: 't-head', finish: 't-head' }[t] ?? 't-dim');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '6px 0 18px' }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: '-.02em' }}>Live Run</h2>
        <span className="micro-mono">
          plan: {profile} · {running ? `${elapsed}s` : lastRun ? `${((lastRun.durationMs ?? 0) / 1000).toFixed(1)}s` : 'idle'}
        </span>
        <div style={{ flex: 1 }} />
        {profiles.length > 0 && (
          <select className="input" style={{ width: 180, padding: '9px 12px' }} value={profile} onChange={(e) => setProfile(e.target.value)} disabled={running}>
            {profiles.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <button className="btn btn-fire" disabled={running || profiles.length === 0} onClick={start}>{running ? 'Running…' : 'Start run'}</button>
      </div>

      {missing.length > 0 && (
        <div className="guard" style={{ marginBottom: 16 }}>
          <div className="g-title">Project not fully ready — Ember will run what it can and report the rest as blocked:</div>
          {missing.map((m) => <div key={m} className="g-item">· {m}</div>)}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 14, alignItems: 'start' }}>
        <div className="term" style={{ minHeight: 440 }}>
          {running && <div className="sweep" />}
          <div className="term-head">
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: running ? 'var(--accent)' : lastRun ? (lastRun.status === 'completed' ? 'var(--ok)' : 'var(--err)') : 'rgba(255,255,255,.15)' }} />
            <span className="label">
              {running ? 'agent running — streaming real steps' : lastRun ? `last run: ${lastRun.status}` : 'idle'}
            </span>
            <div style={{ flex: 1 }} />
            {planChecks.length > 0 && <span className="label">{doneCount}/{planChecks.length} checks</span>}
          </div>
          <div className="term-body" ref={consoleRef} style={{ fontSize: 11 }}>
            {displaySteps.length === 0 && (
              <span className="t-dim" style={{ color: 'rgba(244,244,245,.3)' }}>
                Press Start run — every step, executed command and blocker streams here as the agent does it.
              </span>
            )}
            {displaySteps.map((s, i) => (
              <div key={i} className={clsFor(s.type)}>
                {s.at ? <span style={{ color: 'rgba(139,133,127,.5)', marginRight: 8 }}>{s.at.slice(11, 19)}</span> : null}
                {s.check ? `[${s.check}] ` : ''}{s.message}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card" style={{ padding: '16px 18px' }}>
            <div className="panel-label" style={{ marginBottom: 12 }}>Steps</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {(stepState.length ? stepState : [{ label: 'no plan selected', state: 'pending' }]).map((s) => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5 }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', flex: 'none',
                    background: { done: 'var(--ok)', failed: 'var(--err)', blocked: 'var(--warn)', active: 'var(--accent)', pending: 'rgba(255,255,255,.12)' }[s.state]
                  }} />
                  <span style={{ color: s.state === 'pending' ? 'rgba(244,244,245,.32)' : s.state === 'active' ? '#fff' : 'rgba(244,244,245,.7)' }}>{s.label}</span>
                  {s.state === 'blocked' && <span className="chip warn" style={{ fontSize: 8.5, marginLeft: 'auto' }}>blocked</span>}
                </div>
              ))}
            </div>
            {profiles.length === 0 && (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 12, width: '100%' }} onClick={() => setModule('plans')}>Create a test plan</button>
            )}
          </div>

          {liveIssues.length > 0 && (
            <div style={{ background: 'rgba(239,68,68,.04)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 14, padding: '16px 18px', animation: 'bugPulse 1.4s ease-out' }}>
              <div className="panel-label" style={{ color: 'var(--err)', marginBottom: 10 }}>Issues detected</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {liveIssues.slice(-4).map((s, i) => (
                  <div key={i} className="anim-up" style={{ fontSize: 11.5, lineHeight: 1.5, color: 'rgba(244,244,245,.75)' }}>
                    <span style={{ color: 'var(--err)', fontWeight: 600 }}>FAIL</span> — {s.check ? `[${s.check}] ` : ''}{s.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {lastRun && !running && (
            <div className="card" style={{ padding: '16px 18px' }}>
              <div className="panel-label">Result</div>
              <div style={{ fontSize: 12, lineHeight: 2, fontFamily: 'var(--font-mono)' }}>
                <div><span style={{ color: 'var(--ok)' }}>✓ {lastRun.checksPassed}</span> passed</div>
                <div><span style={{ color: 'var(--err)' }}>✗ {lastRun.checksFailed}</span> failed</div>
                <div><span style={{ color: 'var(--warn)' }}>⚠ {lastRun.checksBlocked}</span> blocked</div>
                <div><span style={{ color: 'var(--info)' }}>▸ {lastRun.commandsExecuted}</span> command(s) executed</div>
              </div>
              <button className="btn btn-white btn-sm" style={{ width: '100%', marginTop: 10 }} onClick={() => setModule('reports')}>Generate report</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
