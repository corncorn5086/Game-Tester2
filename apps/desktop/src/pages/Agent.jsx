import { useEffect, useRef, useState } from 'react';
import { useApp } from '../lib/store.jsx';
import { bridge, isDesktop } from '../lib/bridge.js';

/**
 * Agent Setup (v2): status column + real command execution into a terminal.
 * Every command runs the actual agent core over IPC — nothing simulated.
 */
export default function Agent() {
  const { project, toast, logActivity, setAnalysis, setLogsRes, ingestReport, setLastRun } = useApp();
  const [lines, setLines] = useState([{ text: isDesktop ? '$ ember-agent ready — waiting for commands' : '$ browser preview — agent commands need the desktop shell (npm run dev:desktop) or the CLI', cls: 't-dim' }]);
  const [busy, setBusy] = useState(false);
  const [doctorRes, setDoctorRes] = useState(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [lines]);

  useEffect(() => {
    if (isDesktop) bridge.agent.doctor(project?.root).then((d) => !d?.error && setDoctorRes(d)).catch(() => {});
  }, [project?.root]);

  const print = (text, cls = 't-dim') => setLines((l) => [...l.slice(-300), { text, cls }]);

  const needProject = () => {
    if (!project) {
      print('✗ no project connected — connect one first (Connect module)', 't-warn');
      return true;
    }
    return false;
  };

  const run = async (cmd) => {
    if (busy) return;
    setBusy(true);
    print('', 't-dim');
    print(`$ ${cmd}`, 't-head');
    try {
      if (cmd === 'ember doctor') {
        const res = await bridge.agent.doctor(project?.root);
        if (res?.unavailable) print(res.error, 't-warn');
        else {
          setDoctorRes(res);
          for (const c of res.checks) print(`${{ ok: '✓', warn: '⚠', fail: '✗' }[c.status]} ${c.name}: ${c.detail}`, { ok: 't-ok', warn: 't-warn', fail: 't-err' }[c.status]);
          print(`doctor: ${res.checks.length - res.failed - res.warned} passed, ${res.warned} warning(s), ${res.failed} failing`, 't-dim');
        }
      } else if (cmd === 'ember scan') {
        if (needProject()) return;
        const res = await bridge.agent.scan(project.root);
        if (res?.error) print(`✗ ${res.error}`, 't-err');
        else {
          print(`walking sourcePaths… ${res.filesScanned} files (${res.sourceFileCount} sources)`, 't-dim');
          print(`engine: ${res.engineDetection.engine} (${res.engineDetection.confidence}) — ${res.engineDetection.evidence[0] ?? ''}`, 't-dim');
          print(`top types: ${Object.entries(res.byExtension).slice(0, 5).map(([e, n]) => `${e}:${n}`).join(' ')}`, 't-acc');
          print(`scan complete${res.truncated ? ' (truncated at maxFiles)' : ''}`, 't-ok');
          logActivity('◈', 'var(--info)', `Scan: ${res.filesScanned} files`);
        }
      } else if (cmd === 'ember analyze') {
        if (needProject()) return;
        const res = await bridge.agent.analyze(project.root);
        if (res?.error) print(`✗ ${res.error}`, 't-err');
        else {
          setAnalysis(res);
          print(`analyzed ${res.filesAnalyzed} files, ${res.linesAnalyzed} lines in ${(res.durationMs / 1000).toFixed(1)}s`, 't-dim');
          const s = res.bySeverity;
          print(`findings: ${s.critical} critical · ${s.high} high · ${s.medium} medium · ${s.low} low`, s.critical + s.high > 0 ? 't-acc' : 't-ok');
          for (const f of res.findings.slice(0, 5)) print(`  [${f.severity}] ${f.message} — ${f.file}:${f.line}`, 't-dim');
          print('analysis complete → results in Analyze', 't-ok');
          logActivity('◈', 'var(--high)', `Analysis: ${res.findingCount} finding(s)`);
        }
      } else if (cmd === 'ember logs') {
        if (needProject()) return;
        const res = await bridge.agent.logs(project.root);
        if (res?.error) print(`✗ ${res.error}`, 't-err');
        else {
          setLogsRes(res);
          if (res.blockers.length && !res.logsAnalyzed) for (const b of res.blockers) print(`⚠ ${b.message}`, 't-warn');
          else {
            print(`parsed ${res.logsAnalyzed} log file(s), ${res.linesRead} lines`, 't-dim');
            print(`${res.signals.length} signal(s) — ${res.signals.filter((x) => x.severity === 'critical').length} critical`, res.signals.length ? 't-acc' : 't-ok');
          }
        }
      } else if (cmd === 'ember report') {
        if (needProject()) return;
        print('aggregating scan + analysis + logs…', 't-dim');
        const res = await bridge.agent.report(project.root, {});
        if (res?.error) print(`✗ ${res.error}`, 't-err');
        else {
          ingestReport(res);
          print(`report ${res.id} — ${res.metrics.bugsFound} issue(s), crash risk ${res.metrics.crashRisk}`, 't-ok');
          print('→ open it in Reports', 't-dim');
        }
      } else if (cmd === 'ember config validate') {
        if (needProject()) return;
        const res = await bridge.config.validate(project.root);
        if (res?.unavailable) print(res.error, 't-warn');
        else {
          (res.errors ?? []).forEach((e) => print(`✗ ${e}`, 't-err'));
          (res.warnings ?? []).forEach((w) => print(`⚠ ${w}`, 't-warn'));
          if (res.valid) print('config valid ✓', 't-ok');
        }
      }
    } catch (e) {
      print(`✗ ${e.message}`, 't-err');
    } finally {
      setBusy(false);
    }
  };

  const status = [
    ['Agent bridge', isDesktop ? 'IPC connected' : 'browser preview', isDesktop ? 'var(--ok)' : 'var(--warn)'],
    ['Agent core', '@ember/agent v0.2', 'var(--ok)'],
    ['Project', project ? project.config.projectName : 'not connected', project ? 'var(--ok)' : 'var(--warn)'],
    ['Config', project ? 'valid' : 'missing', project ? 'var(--ok)' : 'var(--warn)'],
    ['Doctor', doctorRes ? `${doctorRes.checks.length - doctorRes.failed} passed · ${doctorRes.warned} warn` : 'not run', doctorRes ? (doctorRes.healthy ? 'var(--ok)' : 'var(--err)') : 'var(--info)']
  ];

  const commands = ['ember doctor', 'ember scan', 'ember analyze', 'ember logs', 'ember report', 'ember config validate'];

  return (
    <div>
      <h2 className="page-title">Agent Setup</h2>
      <p className="page-sub">Ember CLI runs on your machine — every command below executes the real agent core.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {status.map(([label, value, dot]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 11, padding: '12px 16px' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />
              <div style={{ flex: 1, fontSize: 12 }}>{label}</div>
              <div style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'rgba(244,244,245,.45)' }}>{value}</div>
            </div>
          ))}
          <div className="card" style={{ padding: '14px 16px' }}>
            <div className="panel-label" style={{ marginBottom: 10 }}>Commands</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {commands.map((cmd) => (
                <button key={cmd} disabled={busy} onClick={() => run(cmd)} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '9px 12px',
                  border: '1px solid rgba(255,255,255,.07)', borderRadius: 9, cursor: 'pointer', background: 'rgba(255,255,255,.02)',
                  color: 'rgba(244,244,245,.8)', fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'left', transition: 'all .2s',
                  opacity: busy ? 0.5 : 1
                }}>
                  {cmd}
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, color: 'rgba(244,244,245,.35)' }}>run</span>
                </button>
              ))}
            </div>
          </div>
          <div className="card" style={{ padding: '12px 16px', fontSize: 10.5, color: 'var(--ink-faint)', lineHeight: 1.6 }}>
            Install the standalone CLI: <code style={{ fontSize: 10 }}>npm link --workspace @ember/agent</code> — same core, usable in CI.
          </div>
        </div>

        <div className="term" style={{ minHeight: 460 }}>
          <div className="term-head">
            <span className="dot" /><span className="dot" /><span className="dot" />
            <span className="label">ember-agent — stdout</span>
          </div>
          <div className="term-body" ref={bodyRef}>
            {lines.map((l, i) => (
              <div key={i} className={`${l.cls} anim-up`} style={{ animationDuration: '.25s' }}>{l.text}</div>
            ))}
            <span className="cursor" />
          </div>
        </div>
      </div>
    </div>
  );
}
