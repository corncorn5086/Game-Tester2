import { useApp } from '../lib/store.jsx';
import logo from '../assets/ember-logo.png';

/**
 * Command Center (v2): not-connected hero, or connected mission control with
 * key metrics, recent activity, latest run + severity bars, recommended and
 * quick actions. Every number comes from real state — scans, runs and logs.
 */
export default function CommandCenter() {
  const { mode, project, setModule, setPhase, reports, bugs, lastRun, activity } = useApp();

  if (mode !== 'real') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '70px 0 40px', textAlign: 'center' }}>
        <div style={{ position: 'relative', width: 150, height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 28 }}>
          <div style={{ position: 'absolute', width: 170, height: 170, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,77,0,.12), transparent 65%)', animation: 'glowPulse 3s ease-in-out infinite' }} />
          <div style={{ position: 'absolute', width: 160, height: 160, borderRadius: '50%', border: '1px dashed rgba(255,255,255,.12)', animation: 'ringSpin 16s linear infinite' }} />
          <img src={logo} alt="" style={{ width: 84, opacity: 0.8 }} />
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 600, margin: '0 0 10px', letterSpacing: '-.02em' }}>Connect your first game project</h2>
        <p style={{ fontSize: 13, color: 'rgba(244,244,245,.45)', maxWidth: 420, lineHeight: 1.65, margin: '0 0 26px' }}>
          Ember is idle. Point it at a project folder to start scanning code, parsing logs and hunting bugs.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-white" onClick={() => setPhase('onboarding')}>Connect Game Project</button>
        </div>
      </div>
    );
  }

  const report = reports[0] ?? null;
  const m = report?.metrics;
  const openBugs = bugs;
  const sevCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const b of openBugs) sevCounts[b.severity] = (sevCounts[b.severity] ?? 0) + 1;
  const sevMax = Math.max(1, ...Object.values(sevCounts));

  const projectName = project.config.projectName;
  const projectEngine = project.config.engine;
  const projectPath = project.root;

  const keyMetrics = m
    ? [
        [String(m.bugsFound), 'Bugs found', `${m.severityBreakdown.critical} critical · ${m.severityBreakdown.high} high`, 'var(--ink)', m.severityBreakdown.critical ? 'var(--err)' : 'rgba(244,244,245,.4)'],
        [String(m.failedChecks), 'Failed checks', `${m.blockedChecks ?? 0} blocked`, m.failedChecks ? 'var(--high)' : 'var(--ink)', 'var(--high)'],
        [m.crashRisk, 'Crash risk', `regression: ${m.regressionRisk}`, { high: 'var(--err)', medium: 'var(--warn)', low: 'var(--ok)' }[m.crashRisk], 'rgba(244,244,245,.4)'],
        [String(m.filesScanned), 'Files scanned', `${m.logsAnalyzed} logs analyzed`, 'var(--ink)', 'rgba(244,244,245,.4)'],
        [m.buildHealth, 'Build health', `${m.commandsExecuted} command(s) run`, m.buildHealth === 'passing' ? 'var(--ok)' : m.buildHealth === 'failing' ? 'var(--err)' : 'var(--ink-dim)', 'rgba(244,244,245,.4)']
      ]
    : null;

  const latestRunSteps = lastRun?.steps?.filter((s) => ['done', 'failed', 'blocked'].includes(s.type)).slice(0, 5) ?? [];

  const recommended = (report?.recommendedNextActions ?? []).slice(0, 3);
  const quick = [
    ['Connect Project', 'connect'], ['Analyze Codebase', 'analyze'], ['Run Test Plan', 'run'],
    ['Open Reports', 'reports'], ['Test Plans', 'plans'], ['Agent Tools', 'agent']
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: '100%' }}>
      {/* hero row */}
      <div className="anim-up" style={{ display: 'flex', alignItems: 'flex-end', gap: 18, padding: '8px 2px 4px' }}>
        <div>
          <div className="micro" style={{ marginBottom: 8, letterSpacing: '.14em', color: 'rgba(244,244,245,.32)' }}>Mission Control</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 30, fontWeight: 600, margin: 0, letterSpacing: '-.03em', lineHeight: 1 }}>{projectName}</h1>
            <span className="chip fire">{projectEngine}</span>
            <span className="chip ok">Config valid</span>
            <span className="chip dim"><span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ok)', display: 'inline-block' }} />Agent ready · v0.2</span>
          </div>
          <div className="micro-mono" style={{ marginTop: 9, color: 'rgba(244,244,245,.35)' }}>
            {projectPath}{report ? ` · last report ${new Date(report.generatedAt).toLocaleString()}` : ' · no report yet'}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={() => setModule('analyze')}>Analyze codebase</button>
        <button className="btn btn-fire" onClick={() => setModule('run')}>Start test run</button>
      </div>

      {keyMetrics ? (
        <div className="grid g5">
          {keyMetrics.map(([value, label, sub, color, subColor], i) => (
            <div key={label} className="metric anim-up" style={{ animationDelay: `${i * 0.05}s` }}>
              <div className="m-label">{label}</div>
              <div className="m-value" style={{ color }}>{value}</div>
              <div className="m-sub" style={{ color: subColor }}>{sub}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card anim-up" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>No signals collected yet</div>
            <div style={{ fontSize: 12, color: 'var(--ink-dim)' }}>Generate your first report to light up the metrics — scan, static analysis, log mining and regression diff.</div>
          </div>
          <button className="btn btn-white" onClick={() => setModule('reports')}>Generate first report</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.45fr 1fr', gap: 12, flex: 1, alignItems: 'stretch' }}>
        {/* activity */}
        <div className="card anim-up" style={{ animationDelay: '.06s', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div className="panel-label" style={{ marginBottom: 0 }}>Recent Activity</div>
            <span className="micro-mono" style={{ fontSize: 10 }}>session</span>
          </div>
          <div>
            {activity.slice(0, 6).map((a, i) => (
              <div key={i} className="act-row">
                <span className="a-icon" style={{ color: a.color }}>{a.icon}</span>
                <div style={{ flex: 1, color: 'rgba(244,244,245,.75)' }}>{a.text}</div>
                <div className="a-time">{a.time}</div>
              </div>
            ))}
            {activity.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '10px 0' }}>Actions you take (scans, runs, reports, bugs) appear here.</div>}
          </div>
          <div style={{ flex: 1 }} />
        </div>

        {/* latest run + severity */}
        <div className="card anim-up" style={{ animationDelay: '.1s', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div className="panel-label" style={{ marginBottom: 0 }}>
              Latest Run{lastRun ? ` — ${lastRun.profile}` : ''}
            </div>
            {sevCounts.critical > 0 && <span className="chip err" style={{ fontSize: 9 }}>{sevCounts.critical} critical</span>}
          </div>
          <div>
            {latestRunSteps.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,.04)', fontSize: 12 }}>
                <span style={{ fontFamily: 'var(--font-mono)', flex: 'none', width: 14, textAlign: 'center', color: { done: 'var(--ok)', failed: 'var(--err)', blocked: 'var(--warn)' }[s.type] }}>
                  {{ done: '✓', failed: '✗', blocked: '⚠' }[s.type]}
                </span>
                <span style={{ flex: 1, color: 'rgba(244,244,245,.78)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.check ? `[${s.check}] ` : ''}{s.message}</span>
              </div>
            ))}
            {latestRunSteps.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '10px 0' }}>No test run yet — start one from Live Run.</div>}
          </div>
          <div style={{ flex: 1 }} />
          <div className="panel-label" style={{ margin: '16px 0 12px' }}>Issue Severity</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 4 }}>
            {[['Critical', 'critical', 'var(--err)'], ['High', 'high', 'var(--high)'], ['Medium', 'medium', 'var(--warn)'], ['Low', 'low', 'var(--info)']].map(([label, key, color]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ flex: 'none', width: 58, fontSize: 10, color: 'rgba(244,244,245,.5)' }}>{label}</span>
                <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,.05)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(sevCounts[key] / sevMax) * 100}%`, background: color, borderRadius: 3, transition: 'width .6s cubic-bezier(.3,.9,.3,1)' }} />
                </div>
                <span style={{ flex: 'none', width: 16, textAlign: 'right', fontSize: 11, fontFamily: 'var(--font-mono)', color }}>{sevCounts[key]}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => setModule('run')}>Open run details</button>
            <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => setModule('reports')}>Generate report</button>
          </div>
        </div>

        {/* actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card anim-up" style={{ animationDelay: '.12s' }}>
            <div className="panel-label">Recommended</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(recommended.length ? recommended : ['Generate a report to get tailored recommendations']).map((r) => (
                <button key={r} className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start', textAlign: 'left', fontWeight: 500, gap: 10 }} onClick={() => setModule(report ? 'bugs' : 'reports')}>
                  <span style={{ color: 'var(--accent-mid)', fontFamily: 'var(--font-mono)' }}>◈</span>
                  <span style={{ flex: 1, whiteSpace: 'normal', lineHeight: 1.4, fontSize: 11.5 }}>{r}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="card anim-up" style={{ animationDelay: '.16s', flex: 1 }}>
            <div className="panel-label">Quick Actions</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {quick.map(([label, target]) => (
                <button key={label} className="btn btn-ghost btn-xs" style={{ padding: '11px 8px', fontSize: 10.5 }} onClick={() => setModule(target)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
