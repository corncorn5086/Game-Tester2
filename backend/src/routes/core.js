/**
 * Core resources: projects, connected sources, test plans, test runs,
 * bugs and reports.
 */
import { Router } from 'express';
import { makeId, SEVERITIES, BUG_CATEGORIES, BUG_STATUSES } from '@ember/shared/constants';
import { CHECK_TYPES } from '@ember/shared/checks';
import { all, get, run, now, j } from '../db.js';
import { ensureDefaultWorkspace, requireAuth } from '../auth.js';
import { mirrorBugPatch, mirrorProject } from '../supabase.js';

export const coreRouter = Router();

const projectShape = (p) => p && ({
  id: p.id, workspaceId: p.workspace_id, name: p.name, engine: p.engine, path: p.path,
  createdAt: p.created_at, updatedAt: p.updated_at, config: j(p.config_json, {}), archived: !!p.archived
});

// ---------- projects ----------
coreRouter.get('/projects', requireAuth, (_req, res) => {
  res.json(all('SELECT * FROM projects WHERE archived = 0 ORDER BY updated_at DESC').map(projectShape));
});

coreRouter.post('/projects', requireAuth, (req, res) => {
  const { name, engine = 'custom', path = null, config = {} } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  // The workspace is always the authenticated user's — never client-supplied.
  const workspaceId = ensureDefaultWorkspace(req.user.id).id;
  const id = makeId('prj');
  run('INSERT INTO projects (id, workspace_id, name, engine, path, created_at, updated_at, config_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    id, workspaceId, name, engine, path, now(), now(), JSON.stringify(config)
  ]);
  mirrorProject({ id, workspaceId, name, engine, path, config });
  res.status(201).json(projectShape(get('SELECT * FROM projects WHERE id = ?', [id])));
});

coreRouter.get('/projects/:id', requireAuth, (req, res) => {
  const project = get('SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: 'project not found' });
  const sources = all('SELECT * FROM connected_sources WHERE project_id = ?', [req.params.id]);
  res.json({
    ...projectShape(project),
    sources: sources.map((s) => ({ id: s.id, kind: s.kind, location: s.location, createdAt: s.created_at })),
    counts: {
      bugs: get('SELECT COUNT(*) AS n FROM bugs WHERE project_id = ?', [req.params.id]).n,
      runs: get('SELECT COUNT(*) AS n FROM test_runs WHERE project_id = ?', [req.params.id]).n,
      reports: get('SELECT COUNT(*) AS n FROM reports WHERE project_id = ?', [req.params.id]).n
    }
  });
});

coreRouter.patch('/projects/:id', requireAuth, (req, res) => {
  const project = get('SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: 'project not found' });
  const { name, engine, path, config, archived } = req.body ?? {};
  run('UPDATE projects SET name = ?, engine = ?, path = ?, config_json = ?, archived = ?, updated_at = ? WHERE id = ?', [
    name ?? project.name,
    engine ?? project.engine,
    path ?? project.path,
    config ? JSON.stringify(config) : project.config_json,
    archived === undefined ? project.archived : archived ? 1 : 0,
    now(),
    req.params.id
  ]);
  res.json(projectShape(get('SELECT * FROM projects WHERE id = ?', [req.params.id])));
});

coreRouter.post('/projects/:id/sources', requireAuth, (req, res) => {
  const { kind, location, meta = {} } = req.body ?? {};
  if (!kind || !location) return res.status(400).json({ error: 'kind and location are required' });
  const id = makeId('src');
  run('INSERT INTO connected_sources (id, project_id, kind, location, created_at, meta_json) VALUES (?, ?, ?, ?, ?, ?)', [
    id, req.params.id, kind, location, now(), JSON.stringify(meta)
  ]);
  res.status(201).json({ id, kind, location });
});

// ---------- test plans ----------
coreRouter.get('/test-plans', requireAuth, (req, res) => {
  const rows = req.query.projectId
    ? all('SELECT * FROM test_plans WHERE project_id = ? ORDER BY updated_at DESC', [req.query.projectId])
    : all('SELECT * FROM test_plans ORDER BY updated_at DESC');
  res.json(rows.map((p) => ({
    id: p.id, projectId: p.project_id, name: p.name, description: p.description,
    checks: j(p.checks_json, []), commands: j(p.commands_json, []), createdAt: p.created_at, updatedAt: p.updated_at
  })));
});

coreRouter.post('/test-plans', requireAuth, (req, res) => {
  const { projectId = null, name, description = '', checks = [], commands = [] } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const validIds = new Set(CHECK_TYPES.map((chk) => chk.id));
  const invalid = checks.filter((chk) => !validIds.has(chk));
  if (invalid.length) return res.status(400).json({ error: `unknown checks: ${invalid.join(', ')}`, validChecks: [...validIds] });
  const id = makeId('tp');
  run('INSERT INTO test_plans (id, project_id, name, description, checks_json, commands_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    id, projectId, name, description, JSON.stringify(checks), JSON.stringify(commands), now(), now()
  ]);
  res.status(201).json({ id, projectId, name, description, checks, commands });
});

// ---------- test runs ----------
const runShape = (r) => r && ({
  id: r.id, projectId: r.project_id, testPlanId: r.test_plan_id, profile: r.profile, status: r.status,
  startedAt: r.started_at, finishedAt: r.finished_at, createdAt: r.created_at,
  summary: j(r.summary_json, {}), steps: j(r.steps_json, [])
});

coreRouter.get('/test-runs', requireAuth, (req, res) => {
  const rows = req.query.projectId
    ? all('SELECT * FROM test_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 100', [req.query.projectId])
    : all('SELECT * FROM test_runs ORDER BY created_at DESC LIMIT 100');
  res.json(rows.map(runShape));
});

coreRouter.post('/test-runs', requireAuth, (req, res) => {
  const { projectId = null, testPlanId = null, profile = null } = req.body ?? {};
  const id = makeId('run');
  run('INSERT INTO test_runs (id, project_id, test_plan_id, profile, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    id, projectId, testPlanId, profile, 'queued', now()
  ]);
  res.status(201).json(runShape(get('SELECT * FROM test_runs WHERE id = ?', [id])));
});

coreRouter.post('/test-runs/:id/start', requireAuth, (req, res) => {
  const row = get('SELECT * FROM test_runs WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'test run not found' });
  run('UPDATE test_runs SET status = ?, started_at = ? WHERE id = ?', ['running', now(), req.params.id]);
  res.json(runShape(get('SELECT * FROM test_runs WHERE id = ?', [req.params.id])));
});

coreRouter.post('/test-runs/:id/complete', requireAuth, (req, res) => {
  const row = get('SELECT * FROM test_runs WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'test run not found' });
  const { status = 'completed', summary = {}, steps = [] } = req.body ?? {};
  run('UPDATE test_runs SET status = ?, finished_at = ?, summary_json = ?, steps_json = ? WHERE id = ?', [
    status, now(), JSON.stringify(summary), JSON.stringify(steps), req.params.id
  ]);
  res.json(runShape(get('SELECT * FROM test_runs WHERE id = ?', [req.params.id])));
});

// ---------- bugs ----------
const bugShape = (b) => b && ({
  id: b.id, projectId: b.project_id, testRunId: b.test_run_id, title: b.title, description: b.description,
  severity: b.severity, category: b.category, source: b.source, status: b.status, evidence: b.evidence,
  reproducibilityConfidence: b.reproducibility, regressionRisk: b.regression_risk, suggestedFix: b.suggested_fix,
  createdAt: b.created_at, updatedAt: b.updated_at, ...j(b.detail_json, {})
});

coreRouter.get('/bugs', requireAuth, (req, res) => {
  const clauses = [];
  const params = [];
  for (const [field, column] of [['projectId', 'project_id'], ['severity', 'severity'], ['category', 'category'], ['status', 'status'], ['source', 'source']]) {
    if (req.query[field]) {
      clauses.push(`${column} = ?`);
      params.push(req.query[field]);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  res.json(all(`SELECT * FROM bugs ${where} ORDER BY created_at DESC LIMIT 500`, params).map(bugShape));
});

coreRouter.post('/bugs', requireAuth, (req, res) => {
  const b = req.body ?? {};
  if (!b.title) return res.status(400).json({ error: 'title is required' });
  if (b.severity && !SEVERITIES.includes(b.severity)) return res.status(400).json({ error: `severity must be one of ${SEVERITIES.join(', ')}` });
  if (b.category && !BUG_CATEGORIES.includes(b.category)) return res.status(400).json({ error: `category must be one of ${BUG_CATEGORIES.join(', ')}` });
  const id = b.id ?? makeId('bug');
  const detail = {
    filesInvolved: b.filesInvolved ?? [], logsInvolved: b.logsInvolved ?? [],
    stepsToReproduce: b.stepsToReproduce ?? [], expectedResult: b.expectedResult ?? null,
    actualResult: b.actualResult ?? null, relatedTestPlan: b.relatedTestPlan ?? null
  };
  run(`INSERT OR REPLACE INTO bugs (id, project_id, test_run_id, title, description, severity, category, source, status, evidence, reproducibility, regression_risk, suggested_fix, created_at, updated_at, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    id, b.projectId ?? null, b.testRunId ?? null, b.title, b.description ?? null,
    b.severity ?? 'medium', b.category ?? 'gameplay', b.source ?? 'manual-report', b.status ?? 'open',
    b.evidence ?? null, b.reproducibilityConfidence ?? null, b.regressionRisk ?? null, b.suggestedFix ?? null,
    b.createdAt ?? now(), now(), JSON.stringify(detail)
  ]);
  res.status(201).json(bugShape(get('SELECT * FROM bugs WHERE id = ?', [id])));
});

coreRouter.patch('/bugs/:id', requireAuth, (req, res) => {
  const bug = get('SELECT * FROM bugs WHERE id = ?', [req.params.id]);
  if (!bug) return res.status(404).json({ error: 'bug not found' });
  const { status, severity, suggestedFix, description } = req.body ?? {};
  if (status && !BUG_STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${BUG_STATUSES.join(', ')}` });
  run('UPDATE bugs SET status = ?, severity = ?, suggested_fix = ?, description = ?, updated_at = ? WHERE id = ?', [
    status ?? bug.status, severity ?? bug.severity, suggestedFix ?? bug.suggested_fix, description ?? bug.description, now(), req.params.id
  ]);
  mirrorBugPatch(req.params.id, {
    status: status ?? bug.status, severity: severity ?? bug.severity,
    suggested_fix: suggestedFix ?? bug.suggested_fix, description: description ?? bug.description
  });
  res.json(bugShape(get('SELECT * FROM bugs WHERE id = ?', [req.params.id])));
});

// ---------- reports ----------
coreRouter.get('/reports', requireAuth, (req, res) => {
  const rows = req.query.projectId
    ? all('SELECT id, project_id, test_run_id, generated_at, summary, metrics_json FROM reports WHERE project_id = ? ORDER BY generated_at DESC', [req.query.projectId])
    : all('SELECT id, project_id, test_run_id, generated_at, summary, metrics_json FROM reports ORDER BY generated_at DESC LIMIT 100');
  res.json(rows.map((r) => ({ id: r.id, projectId: r.project_id, testRunId: r.test_run_id, generatedAt: r.generated_at, summary: r.summary, metrics: j(r.metrics_json, {}) })));
});

coreRouter.post('/reports', requireAuth, (req, res) => {
  const { projectId = null, testRunId = null, report } = req.body ?? {};
  if (!report) return res.status(400).json({ error: 'report payload is required' });
  const id = report.id ?? makeId('rpt');
  run('INSERT OR REPLACE INTO reports (id, project_id, test_run_id, generated_at, summary, metrics_json, report_json) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    id, projectId, testRunId, report.generatedAt ?? now(), report.executiveSummary ?? null,
    JSON.stringify(report.metrics ?? {}), JSON.stringify(report)
  ]);
  res.status(201).json({ id });
});

coreRouter.get('/reports/:id', requireAuth, (req, res) => {
  const row = get('SELECT * FROM reports WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'report not found' });
  res.json(j(row.report_json, {}));
});
