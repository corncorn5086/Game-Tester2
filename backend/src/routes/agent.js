/**
 * Agent ingestion endpoints — how Ember Agent (CLI) and Ember Desktop
 * push real scan/analysis/report results into the backend. Bugs inside
 * reports are upserted into the bugs table so triage works server-side.
 */
import { Router } from 'express';
import { makeId } from '@ember/shared/constants';
import { all, get, run, now, j } from '../db.js';
import { mirrorEvent, mirrorReport } from '../supabase.js';

export const agentRouter = Router();

function recordEvent(projectId, kind, payload) {
  const id = makeId('evt');
  run('INSERT INTO agent_events (id, project_id, kind, created_at, payload_json) VALUES (?, ?, ?, ?, ?)', [
    id, projectId ?? null, kind, now(), JSON.stringify(payload ?? {})
  ]);
  mirrorEvent({ id, projectId, kind, payload });
}

function notify(type, title, body) {
  run('INSERT INTO notifications (id, type, title, body, created_at) VALUES (?, ?, ?, ?, ?)', [
    makeId('ntf'), type, title, body ?? null, now()
  ]);
}

agentRouter.post('/agent/scan', (req, res) => {
  const { projectId = null, scan } = req.body ?? {};
  if (!scan) return res.status(400).json({ error: 'scan payload is required' });
  recordEvent(projectId, 'scan', {
    filesScanned: scan.filesScanned, engine: scan.engineDetection?.engine, truncated: scan.truncated, scannedAt: scan.scannedAt
  });
  if (projectId) run('UPDATE projects SET updated_at = ? WHERE id = ?', [now(), projectId]);
  res.status(201).json({ ok: true });
});

agentRouter.post('/agent/analyze', (req, res) => {
  const { projectId = null, analysis } = req.body ?? {};
  if (!analysis) return res.status(400).json({ error: 'analysis payload is required' });
  recordEvent(projectId, 'analyze', {
    filesAnalyzed: analysis.filesAnalyzed, findingCount: analysis.findingCount, bySeverity: analysis.bySeverity, analyzedAt: analysis.analyzedAt
  });
  res.status(201).json({ ok: true });
});

agentRouter.post('/agent/report', (req, res) => {
  const { projectId = null, report } = req.body ?? {};
  if (!report) return res.status(400).json({ error: 'report payload is required' });
  const id = report.id ?? makeId('rpt');

  run('INSERT OR REPLACE INTO reports (id, project_id, test_run_id, generated_at, summary, metrics_json, report_json) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    id, projectId, null, report.generatedAt ?? now(), report.executiveSummary ?? null,
    JSON.stringify(report.metrics ?? {}), JSON.stringify(report)
  ]);

  let criticalCount = 0;
  for (const b of report.bugs ?? []) {
    if (b.severity === 'critical') criticalCount++;
    const detail = {
      filesInvolved: b.filesInvolved ?? [], logsInvolved: b.logsInvolved ?? [],
      stepsToReproduce: b.stepsToReproduce ?? [], expectedResult: b.expectedResult ?? null,
      actualResult: b.actualResult ?? null, relatedTestPlan: b.relatedTestPlan ?? null, ruleId: b.ruleId ?? null
    };
    run(`INSERT OR REPLACE INTO bugs (id, project_id, test_run_id, title, description, severity, category, source, status, evidence, reproducibility, regression_risk, suggested_fix, created_at, updated_at, detail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      b.id ?? makeId('bug'), projectId, null, b.title, b.description ?? null, b.severity ?? 'medium',
      b.category ?? 'gameplay', b.source ?? 'code-analysis', b.status ?? 'open', b.evidence ?? null,
      b.reproducibilityConfidence ?? null, b.regressionRisk ?? null, b.suggestedFix ?? null,
      b.createdAt ?? now(), now(), JSON.stringify(detail)
    ]);
  }

  recordEvent(projectId, 'report', { reportId: id, bugs: (report.bugs ?? []).length, metrics: report.metrics });
  mirrorReport(projectId, { ...report, id });
  notify('report-generated', `QA report generated for ${report.project?.name ?? 'project'}`, report.executiveSummary);
  if (criticalCount > 0) notify('critical-bug-found', `${criticalCount} critical issue(s) found in ${report.project?.name ?? 'project'}`, null);

  res.status(201).json({ ok: true, reportId: id, bugsIngested: (report.bugs ?? []).length });
});

agentRouter.get('/agent/events', (req, res) => {
  const rows = req.query.projectId
    ? all('SELECT * FROM agent_events WHERE project_id = ? ORDER BY created_at DESC LIMIT 100', [req.query.projectId])
    : all('SELECT * FROM agent_events ORDER BY created_at DESC LIMIT 100');
  res.json(rows.map((e) => ({ id: e.id, projectId: e.project_id, kind: e.kind, createdAt: e.created_at, payload: j(e.payload_json, {}) })));
});
