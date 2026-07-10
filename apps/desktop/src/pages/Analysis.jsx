import { useMemo, useState } from 'react';
import { useApp } from '../lib/store.jsx';
import { bridge } from '../lib/bridge.js';
import { useProjectGate } from '../components/common.jsx';

/**
 * Code Analysis (v2): Code issues + Logs viewer tabs.
 * Real analysis over IPC; every issue can become a triaged bug.
 */
const SEV_FILTERS = ['all', 'critical', 'high', 'medium', 'low'];
const LOG_FILTERS = [['all', 'All'], ['critical', 'Crashes'], ['high', 'Errors'], ['medium', 'Warnings'], ['low', 'Info']];

export default function Analysis() {
  const { gate, project } = useProjectGate();
  const { analysis, setAnalysis, logsRes, setLogsRes, toast, createBug, logActivity, setModule } = useApp();
  const [tab, setTab] = useState('code');
  const [busy, setBusy] = useState(false);
  const [sev, setSev] = useState('all');
  const [logFilter, setLogFilter] = useState('all');

  const findings = analysis?.findings ?? [];
  const logSignals = useMemo(() => (logsRes?.signals ?? []).map((s) => ({ ...s, label: s.label })), [logsRes]);

  if (gate) return gate;

  const startScan = async () => {
    setBusy(true);
    const [ana, logs] = await Promise.all([bridge.agent.analyze(project.root), bridge.agent.logs(project.root)]);
    setBusy(false);
    if (ana?.error) return toast(ana.error);
    setAnalysis(ana);
    if (!logs?.error) setLogsRes(logs);
    logActivity('◈', 'var(--high)', `Code scan: ${ana.findingCount} finding(s) in ${ana.filesAnalyzed} files`);
    toast(`Scan complete — ${ana.findingCount} finding(s) in ${ana.filesAnalyzed} files`);
  };

  const shownFindings = findings.filter((f) => sev === 'all' || f.severity === sev);
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  findings.forEach((f) => counts[f.severity]++);

  const shownLogs = logSignals.filter((l) => logFilter === 'all' || l.severity === logFilter);
  const logsBlocked = logsRes && logsRes.logsAnalyzed === 0 && logsRes.blockers?.length > 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '6px 0 18px' }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: '-.02em' }}>Code Analysis</h2>
        <div className="seg">
          <button className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')}>Code issues</button>
          <button className={tab === 'logs' ? 'on' : ''} onClick={() => setTab('logs')}>Logs viewer</button>
        </div>
        <div style={{ flex: 1 }} />
        {tab === 'code' && (
          <button className="btn btn-white" disabled={busy} onClick={startScan}>{busy ? 'Scanning…' : analysis ? 'Re-scan' : 'Start scan'}</button>
        )}
      </div>

      {tab === 'code' && (
        <>
          {busy && (
            <div style={{ position: 'relative', background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 14, padding: 26, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ position: 'absolute', left: 0, right: 0, height: 60, background: 'linear-gradient(180deg,transparent,rgba(255,77,0,.08),transparent)', animation: 'scanSweep 1.6s linear infinite' }} />
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Scanning {project?.config?.projectName}…</div>
              <div className="micro-mono">reading {project?.config?.sourcePaths?.join(', ')} — applying {'>'}20 rules + custom rules</div>
            </div>
          )}

          {findings.length > 0 && (
            <>
              <div className="grid g4" style={{ marginBottom: 16 }}>
                {[['Critical', counts.critical, 'var(--err)'], ['High', counts.high, 'var(--high)'], ['Medium', counts.medium, 'var(--warn)'], ['Low', counts.low, 'var(--info)']].map(([label, n, color]) => (
                  <div key={label} className="card" style={{ padding: '14px 16px' }}>
                    <div style={{ fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-mono)', color }}>{n}</div>
                    <div style={{ fontSize: 10, color: 'rgba(244,244,245,.45)', marginTop: 3 }}>{label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 7, marginBottom: 14 }}>
                {SEV_FILTERS.map((f) => (
                  <button key={f} className={`pill ${sev === f ? 'on' : ''}`} onClick={() => setSev(f)}>{f}</button>
                ))}
                <span className="micro-mono" style={{ alignSelf: 'center', marginLeft: 6 }}>{shownFindings.length}/{findings.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {shownFindings.map((f, i) => (
                  <div key={i} className="issue anim-up" style={{ animationDelay: `${Math.min(i, 8) * 0.04}s` }}>
                    <span className={`sev sev-${f.severity}`} style={{ marginTop: 2 }}>{f.severity}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="i-title">{f.message}</div>
                      <div className="i-file">{f.file}{f.line ? `:${f.line}` : ''}{f.ruleId ? ` · rule ${f.ruleId}` : ''}</div>
                      <div className="evidence">{f.evidence}</div>
                      {f.suggest && <div style={{ marginTop: 7, fontSize: 11, color: 'var(--accent-soft)' }}>fix → {f.suggest}</div>}
                    </div>
                    <button className="btn btn-ghost btn-xs" style={{ marginTop: 2 }} onClick={() => createBug(f)}>Create bug</button>
                  </div>
                ))}
              </div>
              {analysis?.suggestedTests?.length > 0 && (
                <div className="card" style={{ marginTop: 16 }}>
                  <div className="panel-label">Tests Ember suggests adding</div>
                  <ul style={{ paddingLeft: 18, fontSize: 12.5, lineHeight: 1.8, color: 'var(--ink-dim)' }}>
                    {analysis.suggestedTests.map((t) => <li key={t.check}><b>{t.check}</b> — {t.reason}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}

          {findings.length === 0 && !busy && (
            <div className="empty-hero">
              <div className="e-title">No scan yet</div>
              <div className="e-sub">Run a scan to detect risky patterns, missing error handling, TODO/FIXME markers and oversized files — with file:line evidence.</div>
              <button className="btn btn-white" onClick={startScan}>Start scan</button>
            </div>
          )}
        </>
      )}

      {tab === 'logs' && (
        <>
          <div style={{ display: 'flex', gap: 7, marginBottom: 14 }}>
            {LOG_FILTERS.map(([key, label]) => (
              <button key={key} className={`pill ${logFilter === key ? 'on' : ''}`} onClick={() => setLogFilter(key)}>{label}</button>
            ))}
          </div>

          {logsBlocked && (
            <div className="empty-hero">
              <div className="e-title">No logs to read</div>
              <div className="e-sub">{logsRes.blockers[0].message}</div>
              <button className="btn btn-white" onClick={() => setModule('connect')}>Connect Logs Folder</button>
            </div>
          )}

          {!logsBlocked && shownLogs.length > 0 && (
            <div style={{ background: 'var(--term)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 14, overflow: 'hidden' }}>
              {shownLogs.map((l, i) => (
                <div key={i} className="log-row">
                  <span className={`lvl lvl-${{ critical: 'crash', high: 'error', medium: 'warning', low: 'info' }[l.severity] ?? 'info'}`}>
                    {{ critical: 'crash', high: 'error', medium: 'warning', low: 'info' }[l.severity] ?? 'info'}
                  </span>
                  <span style={{ flex: 1, color: 'rgba(244,244,245,.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.evidence}>
                    {l.label}{l.occurrences > 1 ? ` (×${l.occurrences})` : ''} — {l.evidence}
                  </span>
                  <button className="btn btn-ghost btn-xs" onClick={() => createBug({ ...l, level: 'log', title: l.label, logFile: l.file })}>Bug</button>
                </div>
              ))}
            </div>
          )}

          {!logsBlocked && shownLogs.length === 0 && (
            <div className="empty-hero">
              <div className="e-title">{logsRes ? 'No signals at this filter level' : 'Logs not parsed yet'}</div>
              <div className="e-sub">
                {logsRes
                  ? 'Ember only lists real log signals — change the filter or generate fresh logs by playing a session.'
                  : 'Run a scan (Code issues tab) or `ember logs` in Agent to parse the configured logsPath.'}
              </div>
            </div>
          )}

          {logsRes?.files?.length > 0 && (
            <div className="micro-mono" style={{ marginTop: 12 }}>
              parsed: {logsRes.files.map((f) => f.path.split(/[\\/]/).pop()).join(' · ')} ({logsRes.linesRead} lines)
            </div>
          )}
        </>
      )}
    </div>
  );
}
