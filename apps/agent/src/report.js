import { makeId } from '@ember/shared/constants';
import { bugsFromRun } from './bugs.js';
import { nowIso } from './util.js';

/**
 * Assemble a professional QA report from real run artifacts.
 * Metrics are counted from evidence; there is no synthetic score.
 */
export function buildReport({ config, root, scan, analyze, logs, run }) {
  const executions = run?.executions ?? [];
  const bugs = bugsFromRun({ analyze, logs, executions, testPlanId: run?.profile ?? null });

  const severityBreakdown = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const b of bugs) severityBreakdown[b.severity] = (severityBreakdown[b.severity] ?? 0) + 1;

  const affectedSystems = [...new Set(bugs.map((b) => b.category))];
  const crashSignals = bugs.filter((b) => b.category === 'crash');
  const perfWarnings = (analyze?.findings ?? []).filter((f) => f.category === 'performance').length +
    bugs.filter((b) => b.category === 'performance').length;

  const failedChecks = run?.checksFailed ?? 0;
  const blockedChecks = run?.checksBlocked ?? 0;
  const commandsExecuted = run?.commandsExecuted ?? 0;

  const crashRisk = crashSignals.some((b) => b.severity === 'critical')
    ? 'high'
    : crashSignals.length > 0
      ? 'medium'
      : 'low';

  const buildExec = executions.find((e) => e.check === 'build');
  const buildHealth = buildExec ? (buildExec.failed ? 'failing' : 'passing') : 'not-configured';

  const regressionRisks = bugs
    .filter((b) => b.regressionRisk === 'high')
    .map((b) => ({ bugId: b.id, title: b.title, reason: `${b.severity} ${b.category} issue — verify it stays fixed after changes` }));

  const metrics = {
    bugsFound: bugs.length,
    crashRisk,
    failedChecks,
    blockedChecks,
    testCoverage: run
      ? { checksRun: (run.checksPassed ?? 0) + failedChecks, checksBlocked: blockedChecks, note: 'coverage = agent checks executed vs blocked; engine-level coverage requires SDK integration' }
      : null,
    reproducibilityConfidence: summarizeConfidence(bugs),
    affectedSystems,
    regressionRisk: regressionRisks.length > 3 ? 'high' : regressionRisks.length > 0 ? 'medium' : 'low',
    performanceWarnings: perfWarnings,
    buildHealth,
    severityBreakdown,
    logsAnalyzed: logs?.logsAnalyzed ?? 0,
    filesScanned: scan?.filesScanned ?? analyze?.scan?.filesScanned ?? 0,
    commandsExecuted,
    testPlansCompleted: run?.status === 'completed' ? 1 : 0
  };

  const report = {
    id: makeId('rpt'),
    kind: 'report',
    generatedAt: nowIso(),
    generator: 'ember-agent@0.2.0',
    project: {
      name: config?.projectName ?? '(unknown)',
      engine: config?.engine ?? '(unknown)',
      root
    },
    executiveSummary: buildSummary({ config, metrics, bugs, run, logs, analyze }),
    metrics,
    bugs,
    criticalIssues: bugs.filter((b) => b.severity === 'critical'),
    suggestedFixes: bugs.filter((b) => b.suggestedFix).map((b) => ({ bugId: b.id, title: b.title, fix: b.suggestedFix, file: b.filesInvolved[0] ?? null })),
    regressionRisks,
    suggestedTests: analyze?.suggestedTests ?? [],
    blockers: [...(logs?.blockers ?? []), ...(run?.steps ?? []).filter((s) => s.type === 'blocked').map((s) => ({ code: s.check, message: s.message }))],
    testRun: run
      ? {
          profile: run.profile,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          durationMs: run.durationMs,
          checksPassed: run.checksPassed,
          checksFailed: run.checksFailed,
          checksBlocked: run.checksBlocked,
          steps: run.steps.filter((s) => s.type !== 'output')
        }
      : null,
    recommendedNextActions: buildNextActions({ config, metrics, bugs, logs, run })
  };
  report.releaseReadiness = buildReleaseReadiness({ metrics, bugs, run });
  return report;
}

/**
 * Release Readiness Score: a transparent 0-100 score with every deduction
 * traceable to a real signal — never an opaque or invented number.
 */
function buildReleaseReadiness({ metrics, bugs, run }) {
  const sb = metrics.severityBreakdown;
  const deductions = [];
  const deduct = (points, reason) => { if (points > 0) deductions.push({ points, reason }); };

  deduct(Math.min(sb.critical * 25, 60), sb.critical ? `${sb.critical} critical bug(s) open` : null);
  deduct(Math.min(sb.high * 10, 30), sb.high ? `${sb.high} high-severity bug(s) open` : null);
  deduct(Math.min(sb.medium * 3, 15), sb.medium ? `${sb.medium} medium-severity bug(s) open` : null);

  if (metrics.crashRisk === 'high') deduct(15, 'Crash risk is high');
  else if (metrics.crashRisk === 'medium') deduct(7, 'Crash risk is medium');

  if (metrics.buildHealth === 'failing') deduct(20, 'Build is failing');
  else if (metrics.buildHealth === 'not-configured') deduct(5, 'Build health unknown — no buildCommand configured');

  if (metrics.regressionRisk === 'high') deduct(10, 'High regression risk — previously fixed issues may resurface');
  else if (metrics.regressionRisk === 'medium') deduct(5, 'Medium regression risk');

  deduct(Math.min(metrics.failedChecks * 5, 20), metrics.failedChecks ? `${metrics.failedChecks} check(s) failed` : null);
  deduct(Math.min(metrics.blockedChecks * 2, 10), metrics.blockedChecks ? `${metrics.blockedChecks} check(s) blocked (missing SDK/config)` : null);

  if (metrics.filesScanned === 0) deduct(10, 'No files were scanned — signals are incomplete');
  if (metrics.logsAnalyzed === 0) deduct(5, 'No logs were analyzed — crash/error signals may be missing');

  const totalDeduction = deductions.reduce((sum, d) => sum + d.points, 0);
  const score = Math.max(0, Math.min(100, 100 - totalDeduction));
  const band = score >= 85 ? 'ready' : score >= 60 ? 'needs-fixes' : 'risky';
  const bandLabel = { ready: 'Ready', 'needs-fixes': 'Needs fixes', risky: 'Risky release' }[band];

  const blocksRelease = [];
  if (sb.critical > 0) blocksRelease.push(`${sb.critical} critical bug(s) must be fixed before release.`);
  if (metrics.buildHealth === 'failing') blocksRelease.push('The build is currently failing.');
  if (metrics.crashRisk === 'high') blocksRelease.push('Crash risk is high based on real crash-category findings.');

  const risksIfShipped = [];
  if (sb.high > 0) risksIfShipped.push(`${sb.high} high-severity issue(s) will reach players.`);
  if (metrics.regressionRisk !== 'low') risksIfShipped.push('Previously fixed bugs may resurface (regression risk).');
  if (metrics.blockedChecks > 0) risksIfShipped.push(`${metrics.blockedChecks} check(s) never ran — real coverage is lower than it looks.`);
  if (metrics.logsAnalyzed === 0) risksIfShipped.push('No log evidence was available — crash signals may be under-detected.');

  return {
    score,
    band,
    bandLabel,
    deductions: deductions.filter((d) => d.reason),
    blocksRelease,
    risksIfShipped,
    note: 'Score is fully derived from this report\'s metrics — every point lost is listed in "deductions".'
  };
}

function summarizeConfidence(bugs) {
  if (bugs.length === 0) return null;
  const counts = { high: 0, medium: 0, low: 0 };
  for (const b of bugs) counts[b.reproducibilityConfidence] = (counts[b.reproducibilityConfidence] ?? 0) + 1;
  return counts;
}

function buildSummary({ config, metrics, bugs, run, logs, analyze }) {
  const parts = [];
  parts.push(`Ember analyzed ${config?.projectName ?? 'the project'} (${config?.engine ?? 'unknown engine'}).`);
  if (metrics.filesScanned) parts.push(`${metrics.filesScanned} files scanned, ${analyze?.filesAnalyzed ?? 0} source files analyzed (${analyze?.linesAnalyzed ?? 0} lines).`);
  if (metrics.logsAnalyzed) parts.push(`${metrics.logsAnalyzed} log file(s) parsed.`);
  if (run) parts.push(`Test profile "${run.profile}" ${run.status}: ${run.checksPassed} passed, ${run.checksFailed} failed, ${run.checksBlocked} blocked.`);
  if (bugs.length) {
    const sb = metrics.severityBreakdown;
    parts.push(`${bugs.length} issue(s) opened from real signals — ${sb.critical} critical, ${sb.high} high, ${sb.medium} medium, ${sb.low} low. Crash risk: ${metrics.crashRisk}.`);
  } else {
    parts.push('No issues were opened from the signals available in this run.');
  }
  const blocked = metrics.blockedChecks ?? 0;
  if (blocked) parts.push(`${blocked} check(s) were blocked — see blockers for the exact configuration or integration missing.`);
  return parts.join(' ');
}

function buildNextActions({ config, metrics, bugs, logs, run }) {
  const actions = [];
  if (bugs.some((b) => b.severity === 'critical')) actions.push('Fix the critical issues first — they are crash- or data-loss-level.');
  if (metrics.buildHealth === 'not-configured') actions.push('Set "buildCommand" in ember.config.json so Ember can verify your build.');
  if (!config?.testCommand) actions.push('Set "testCommand" so Ember can run your engine test suite.');
  if ((logs?.blockers ?? []).some((b) => b.code === 'logs-path-missing' || b.code === 'logs-folder-not-found')) {
    actions.push('Point "logsPath" at your game logs so Ember can mine real crash signals.');
  }
  if ((run?.checksBlocked ?? 0) > 0) actions.push('Install the Ember SDK/input driver for your engine to unlock gameplay checks (see docs/game-integration.md).');
  if (bugs.length > 0) actions.push('Re-run `ember run` after fixes — regression tracking compares reports to verify fixed bugs stay fixed.');
  if (actions.length === 0) actions.push('Schedule Ember in CI (ember run --profile smoke) to keep this state.');
  return actions;
}

/** Render a report as professional Markdown. */
export function reportToMarkdown(report) {
  const m = report.metrics;
  const lines = [];
  const sb = m.severityBreakdown;

  lines.push(`# Ember QA Report — ${report.project.name}`);
  lines.push('');
  lines.push(`> Generated ${report.generatedAt} by ${report.generator} · Engine: **${report.project.engine}**`);
  lines.push('');
  lines.push('## Executive summary');
  lines.push('');
  lines.push(report.executiveSummary);
  lines.push('');
  if (report.aiExecutiveSummary) {
    lines.push(`## AI summary${report.aiProvider ? ` (${report.aiProvider === 'claude' ? 'Claude Fable 5' : 'OpenAI'})` : ''}`);
    lines.push('');
    lines.push(report.aiExecutiveSummary);
    lines.push('');
  }
  if (report.releaseReadiness) {
    const rr = report.releaseReadiness;
    lines.push(`## Release Readiness — ${rr.score}/100 (${rr.bandLabel})`);
    lines.push('');
    if (rr.deductions.length) {
      lines.push('| Deduction | Reason |');
      lines.push('|---|---|');
      for (const d of rr.deductions) lines.push(`| -${d.points} | ${d.reason} |`);
      lines.push('');
    }
    if (rr.blocksRelease.length) {
      lines.push('**What blocks release:**');
      for (const b of rr.blocksRelease) lines.push(`- ${b}`);
      lines.push('');
    }
    if (rr.risksIfShipped.length) {
      lines.push('**Risks if you ship today:**');
      for (const r of rr.risksIfShipped) lines.push(`- ${r}`);
      lines.push('');
    }
  }
  lines.push('## Metrics');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Bugs found | ${m.bugsFound} |`);
  lines.push(`| Crash risk | ${m.crashRisk} |`);
  lines.push(`| Failed checks | ${m.failedChecks} |`);
  lines.push(`| Blocked checks | ${m.blockedChecks} |`);
  lines.push(`| Severity breakdown | ${sb.critical} critical / ${sb.high} high / ${sb.medium} medium / ${sb.low} low |`);
  lines.push(`| Regression risk | ${m.regressionRisk} |`);
  lines.push(`| Performance warnings | ${m.performanceWarnings} |`);
  lines.push(`| Build health | ${m.buildHealth} |`);
  lines.push(`| Logs analyzed | ${m.logsAnalyzed} |`);
  lines.push(`| Files scanned | ${m.filesScanned} |`);
  lines.push(`| Commands executed | ${m.commandsExecuted} |`);
  lines.push(`| Test plans completed | ${m.testPlansCompleted} |`);
  lines.push(`| Affected systems | ${m.affectedSystems.join(', ') || '—'} |`);
  lines.push('');

  if (report.criticalIssues.length) {
    lines.push('## Critical issues');
    lines.push('');
    for (const b of report.criticalIssues) {
      lines.push(`- **${b.title}** — ${b.evidence}`);
    }
    lines.push('');
  }

  if (report.bugs.length) {
    lines.push('## Bugs');
    lines.push('');
    for (const b of report.bugs) {
      lines.push(`### ${b.title}`);
      lines.push('');
      lines.push(`- **ID:** ${b.id}`);
      lines.push(`- **Severity:** ${b.severity} · **Category:** ${b.category} · **Source:** ${b.source} · **Status:** ${b.status}`);
      lines.push(`- **Reproducibility confidence:** ${b.reproducibilityConfidence} · **Regression risk:** ${b.regressionRisk}`);
      if (b.filesInvolved.length) lines.push(`- **Files:** ${b.filesInvolved.join(', ')}${b.line ? ` (line ${b.line})` : ''}`);
      if (b.logsInvolved.length) lines.push(`- **Logs:** ${b.logsInvolved.join(', ')}`);
      lines.push(`- **Evidence:** \`${b.evidence}\``);
      lines.push('- **Steps to reproduce:**');
      b.stepsToReproduce.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
      lines.push(`- **Expected:** ${b.expectedResult}`);
      lines.push(`- **Actual:** ${b.actualResult}`);
      if (b.suggestedFix) lines.push(`- **Suggested fix:** ${b.suggestedFix}`);
      lines.push('');
    }
  }

  if (report.blockers.length) {
    lines.push('## Blockers (what Ember could not do yet)');
    lines.push('');
    for (const bl of report.blockers) lines.push(`- \`${bl.code ?? 'blocked'}\` — ${bl.message}`);
    lines.push('');
  }

  if (report.suggestedTests.length) {
    lines.push('## Suggested tests to add');
    lines.push('');
    for (const t of report.suggestedTests) lines.push(`- **${t.check}** — ${t.reason}`);
    lines.push('');
  }

  lines.push('## Recommended next actions');
  lines.push('');
  report.recommendedNextActions.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
  lines.push('');
  lines.push('---');
  lines.push('_Every item in this report is derived from real signals: file scans, static analysis matches, log entries and command exit codes. Blocked checks are listed as blocked — never simulated._');
  return lines.join('\n');
}
