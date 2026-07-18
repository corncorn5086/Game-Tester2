import { makeId } from '@ember/shared/constants';
import { nowIso } from './util.js';

/**
 * Convert real signals (analysis findings, log signals, failed commands)
 * into professional bug records. Reproducibility confidence is derived
 * from the nature of the evidence, not invented:
 *  - static finding  → 'high'   (deterministic: the pattern is in the code)
 *  - repeated log signal → 'high', single occurrence → 'medium'
 *  - failed command → 'high' (rerun the command)
 */
export function bugsFromRun({ analyze, logs, executions = [], testPlanId = null } = {}) {
  const bugs = [];
  const createdAt = nowIso();

  for (const f of analyze?.findings ?? []) {
    if (f.severity === 'low') continue; // low static findings stay as findings, not bugs
    bugs.push({
      id: makeId('bug'),
      title: f.message,
      description: `Static analysis rule \`${f.ruleId}\` matched in \`${f.file}\` line ${f.line}.`,
      severity: f.severity,
      category: f.category,
      source: 'code-analysis',
      evidence: f.evidence,
      filesInvolved: [f.file],
      logsInvolved: [],
      stepsToReproduce: [
        `Open ${f.file} at line ${f.line}`,
        `Observe: ${f.evidence}`,
        'Exercise this code path in game to confirm runtime impact'
      ],
      expectedResult: 'Code path handles edge cases without failure',
      actualResult: f.message,
      reproducibilityConfidence: 'high',
      suggestedFix: f.suggest || null,
      regressionRisk: f.severity === 'critical' || f.severity === 'high' ? 'high' : 'medium',
      status: 'open',
      createdAt,
      relatedTestPlan: testPlanId,
      ruleId: f.ruleId,
      line: f.line
    });
  }

  for (const s of logs?.signals ?? []) {
    bugs.push({
      id: makeId('bug'),
      title: `${s.label} (${s.occurrences}× in logs)`,
      description: `Log analysis detected "${s.label}" in ${s.file}${s.firstLine ? ` (first at line ${s.firstLine})` : ''}.`,
      severity: s.severity,
      category: s.category,
      source: s.label === 'Crash dumps present' ? 'crash-report' : 'logs',
      evidence: s.evidence,
      filesInvolved: [],
      logsInvolved: [s.file],
      stepsToReproduce: [
        'Reproduce the session that generated this log',
        `Watch for: ${s.evidence}`,
        s.occurrences > 1 ? `Signal repeated ${s.occurrences} times — likely reproducible` : 'Single occurrence — capture more logs to confirm'
      ],
      expectedResult: 'Session completes without this error',
      actualResult: s.evidence,
      reproducibilityConfidence: s.occurrences > 2 ? 'high' : s.occurrences > 1 ? 'medium' : 'low',
      suggestedFix: null,
      regressionRisk: s.severity === 'critical' ? 'high' : 'medium',
      status: 'open',
      createdAt,
      relatedTestPlan: testPlanId,
      context: s.context
    });
  }

  for (const ex of executions) {
    for (const s of ex.signals ?? []) {
      bugs.push({
        id: makeId('bug'),
        title: `${s.label} — ${ex.check ?? 'command'}`,
        description: `Command \`${ex.command}\` ${ex.timedOut ? 'timed out' : `exited with code ${ex.exitCode}`} after ${(ex.durationMs / 1000).toFixed(1)}s.`,
        severity: s.severity,
        category: s.category,
        source: 'test-run',
        evidence: s.evidence,
        filesInvolved: [],
        logsInvolved: [],
        stepsToReproduce: [`Run: ${ex.command}`, `Observe exit code ${ex.exitCode ?? '(spawn error)'}`],
        expectedResult: 'Command completes with exit code 0 and no errors',
        actualResult: s.evidence,
        reproducibilityConfidence: 'high',
        suggestedFix: null,
        regressionRisk: 'high',
        status: 'open',
        createdAt,
        relatedTestPlan: testPlanId,
        errorLines: s.errorLines ?? []
      });
    }
  }

  return dedupeBugs(bugs);
}

function dedupeBugs(bugs) {
  const seen = new Map();
  for (const bug of bugs) {
    const key = `${bug.source}:${bug.title}:${bug.filesInvolved[0] ?? ''}:${bug.line ?? ''}`;
    if (!seen.has(key)) seen.set(key, bug);
  }
  return [...seen.values()];
}
