import { useState } from 'react';
import { useApp } from '../lib/store.jsx';
import { bridge } from '../lib/bridge.js';
import { useProjectGate } from '../components/common.jsx';

/**
 * Bug Reports (v2): 3-column triage board + right-side detail drawer.
 * Bugs come from real reports, real scans and real log signals.
 */
export function BugDrawer({ bug, onClose }) {
  const { updateBug, toast, settings } = useApp();
  const [ai, setAi] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);

  const explainWithAi = async () => {
    setAiBusy(true);
    const res = await bridge.agent.aiExplainBug(bug, settings.aiProvider);
    setAiBusy(false);
    if (res?.ok) setAi(res);
    else toast(res?.error || 'AI explanation unavailable');
  };

  const copy = () => {
    const txt = `${bug.id} [${bug.severity}] ${bug.title}\nCategory: ${bug.category} · Source: ${bug.source} · Status: ${bug.status}\nFiles: ${(bug.filesInvolved ?? []).join(', ') || '—'}${bug.line ? `:${bug.line}` : ''}\nEvidence: ${bug.evidence}\nSteps:\n${(bug.stepsToReproduce ?? []).map((s, i) => `  ${i + 1}. ${s}`).join('\n')}\nFix: ${bug.suggestedFix ?? 'pending'}`;
    navigator.clipboard?.writeText(txt).then(() => toast('Bug summary copied'), () => toast('Clipboard unavailable'));
  };

  const exportJson = async () => {
    const f = await bridge.file.saveAs({ title: 'Export bug', defaultPath: `${bug.id}.json`, content: JSON.stringify(bug, null, 2) });
    if (f) toast(`Exported ${f}`);
  };

  const fields = [
    ['Source', bug.source, false],
    ['Category', bug.category, false],
    ['Files involved', [(bug.filesInvolved ?? []).join(', ') || '—', bug.line ? `line ${bug.line}` : null].filter(Boolean).join(' · '), true],
    bug.logsInvolved?.length ? ['Logs involved', bug.logsInvolved.join(', '), true] : null,
    ['Evidence', bug.evidence, true],
    ['Steps to reproduce', (bug.stepsToReproduce ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n'), true],
    ['Reproducibility confidence', bug.reproducibilityConfidence ?? '—', false],
    ['Regression risk', bug.regressionRisk ?? '—', false],
    ['Suggested fix', bug.suggestedFix ?? 'Pending analysis.', false],
    ['Status', bug.status, false],
    ['Created', bug.createdAt ? new Date(bug.createdAt).toLocaleString() : '—', false]
  ].filter(Boolean);

  return (
    <div className="drawer-veil" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <span className={`sev sev-${bug.severity}`}>{bug.severity}</span>
          <span className="micro-mono">{bug.id}</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'rgba(244,244,245,.45)', fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>
        <h3 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 16px', lineHeight: 1.4, letterSpacing: '-.01em' }}>{bug.title}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {fields.map(([label, value, mono]) => (
            <div key={label}>
              <div className="f-label">{label}</div>
              <div className={`f-value ${mono ? 'mono' : ''}`} style={mono ? { fontFamily: 'var(--font-mono)' } : undefined}>{value}</div>
            </div>
          ))}
          <div>
            <div className="f-label">AI explanation{ai ? ` (${ai.provider === 'openai' ? 'OpenAI' : 'Claude Fable 5'})` : ''}</div>
            {ai ? (
              <div className="f-value" style={{ whiteSpace: 'pre-wrap' }}>{ai.text}</div>
            ) : (
              <button className="btn btn-ghost btn-sm" disabled={aiBusy} onClick={explainWithAi}>{aiBusy ? 'Asking AI…' : 'Explain with AI'}</button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
          {bug.status !== 'fixed' && (
            <button className="btn btn-white btn-sm" style={{ flex: 1 }} onClick={() => { updateBug(bug.id, { status: 'fixed' }); toast(`${bug.id} marked fixed — regression tracking verifies it stays fixed`); onClose(); }}>
              Mark fixed
            </button>
          )}
          {bug.status === 'fixed' && (
            <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => updateBug(bug.id, { status: 'open' })}>Reopen</button>
          )}
          <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={copy}>Copy summary</button>
          <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={exportJson}>Export JSON</button>
        </div>
      </div>
    </div>
  );
}

export default function Bugs() {
  const { gate } = useProjectGate();
  const { bugs, setSelectedBug, setModule } = useApp();

  if (gate) return gate;

  const list = bugs;
  const open = list.filter((b) => b.status !== 'fixed' && b.status !== 'wont-fix');

  const columns = [
    ['Critical', 'var(--err)', (b) => b.severity === 'critical'],
    ['High', 'var(--high)', (b) => b.severity === 'high'],
    ['Medium & below', 'var(--warn)', (b) => b.severity === 'medium' || b.severity === 'low']
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '6px 0 18px' }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: '-.02em' }}>Bug Reports</h2>
        <span className="micro-mono">{open.length} open · {list.length - open.length} resolved</span>
      </div>

      {list.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, alignItems: 'start' }}>
          {columns.map(([label, color, filter]) => {
            const colBugs = list.filter(filter);
            return (
              <div key={label} style={{ background: 'rgba(255,255,255,.015)', border: '1px solid rgba(255,255,255,.05)', borderRadius: 14, padding: 14, minHeight: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
                  <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color }}>{label}</span>
                  <span className="micro-mono" style={{ fontSize: 10 }}>{colBugs.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {colBugs.map((b) => (
                    <div key={b.id} className="anim-up" onClick={() => setSelectedBug(b)} style={{
                      background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 11,
                      padding: '13px 15px', cursor: 'pointer', transition: 'all .2s', opacity: b.status === 'fixed' ? 0.5 : 1
                    }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.4, marginBottom: 8 }}>{b.title}</div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span className="chip fire" style={{ fontSize: 8.5, padding: '2px 8px' }}>{b.category}</span>
                        <span className="chip dim" style={{ fontSize: 8.5, padding: '2px 8px' }}>{b.status}</span>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(244,244,245,.3)' }}>{b.id}</span>
                      </div>
                    </div>
                  ))}
                  {colBugs.length === 0 && <div style={{ fontSize: 11, color: 'var(--ink-ghost)', padding: '8px 2px' }}>None — good.</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-hero">
          <div className="e-title">No bugs found yet</div>
          <div className="e-sub">Run a code analysis or generate a report to surface real issues, then triage them here.</div>
          <button className="btn btn-white" onClick={() => setModule('analyze')}>Analyze Codebase</button>
        </div>
      )}
    </div>
  );
}
