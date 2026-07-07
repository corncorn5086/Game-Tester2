/**
 * Platform routes: settings, billing (Stripe-ready placeholders), team,
 * exports/imports, notifications, usage metrics and report sharing.
 */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { makeId, TEAM_ROLES } from '@ember/shared/constants';
import { PLANS, getPlan } from '@ember/shared/plans';
import { all, get, run, now, j } from '../db.js';
import { cloudTeam, mirrorInvite, supabaseEnabled } from '../supabase.js';
import { captureOrder, listProviders, startCheckout } from '../payments/index.js';

export const platformRouter = Router();

// ---------- settings (global/workspace key-value) ----------
platformRouter.get('/settings', (_req, res) => {
  const rows = all('SELECT key, value_json FROM settings');
  res.json(Object.fromEntries(rows.map((r) => [r.key, j(r.value_json)])));
});

platformRouter.patch('/settings', (req, res) => {
  const entries = Object.entries(req.body ?? {});
  for (const [key, value] of entries) {
    run('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at', [
      key, JSON.stringify(value), now()
    ]);
  }
  res.json({ ok: true, updated: entries.map(([k]) => k) });
});

// ---------- billing ----------
platformRouter.get('/billing/plans', (_req, res) => res.json(PLANS));

platformRouter.get('/billing/subscription', (req, res) => {
  const workspaceId = req.query.workspaceId ?? null;
  const sub = workspaceId
    ? get('SELECT * FROM subscriptions WHERE workspace_id = ?', [workspaceId])
    : get('SELECT * FROM subscriptions ORDER BY created_at ASC LIMIT 1');
  if (!sub) return res.json({ plan: getPlan('free'), status: 'active', note: 'No workspace subscription yet — defaulting to Free.' });
  res.json({ id: sub.id, workspaceId: sub.workspace_id, plan: getPlan(sub.plan_id) ?? getPlan('free'), status: sub.status, currentPeriodEnd: sub.current_period_end });
});

platformRouter.get('/billing/providers', (_req, res) => res.json(listProviders()));

platformRouter.post('/billing/checkout', async (req, res) => {
  const { planId, provider = 'paypal' } = req.body ?? {};
  const plan = getPlan(planId);
  if (!plan) return res.status(400).json({ error: `unknown plan "${planId}"`, plans: PLANS.map((p) => p.id) });
  if (!plan.price) return res.status(400).json({ error: plan.id === 'enterprise' ? 'Enterprise is custom-quoted — contact us.' : 'The Free plan needs no checkout.' });
  try {
    const result = await startCheckout(provider, plan, {});
    if (result.error) return res.status(result.notConfigured ? 501 : 400).json({ ...result, plan: plan.id, provider });
    run('INSERT INTO usage_events (id, kind, quantity, created_at, meta_json) VALUES (?, ?, ?, ?, ?)', [
      makeId('use'), 'checkout-started', 1, now(), JSON.stringify({ plan: plan.id, provider, orderId: result.orderId })
    ]);
    res.json({ ...result, plan: plan.id, provider });
  } catch (e) {
    res.status(502).json({ error: `payment provider error: ${e.message}`, provider });
  }
});

platformRouter.post('/billing/paypal/capture', async (req, res) => {
  const { orderId, workspaceId = null } = req.body ?? {};
  if (!orderId) return res.status(400).json({ error: 'orderId is required' });
  try {
    const result = await captureOrder(orderId);
    if (result.error) return res.status(501).json(result);
    if (result.captured && result.planId) {
      const sub = workspaceId
        ? get('SELECT * FROM subscriptions WHERE workspace_id = ?', [workspaceId])
        : get('SELECT * FROM subscriptions ORDER BY created_at ASC LIMIT 1');
      const periodEnd = new Date(Date.now() + 31 * 24 * 3600 * 1000).toISOString();
      if (sub) {
        run('UPDATE subscriptions SET plan_id = ?, status = ?, current_period_end = ?, updated_at = ? WHERE id = ?', [
          result.planId, 'active', periodEnd, now(), sub.id
        ]);
      } else {
        run('INSERT INTO subscriptions (id, workspace_id, plan_id, status, current_period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
          makeId('sub'), workspaceId, result.planId, 'active', periodEnd, now(), now()
        ]);
      }
      run('INSERT INTO usage_events (id, kind, quantity, created_at, meta_json) VALUES (?, ?, ?, ?, ?)', [
        makeId('use'), 'payment-captured', 1, now(), JSON.stringify({ provider: 'paypal', ...result })
      ]);
      run('INSERT INTO notifications (id, type, title, body, created_at) VALUES (?, ?, ?, ?, ?)', [
        makeId('ntf'), 'report-generated', `Payment received — ${result.planId} plan active`, `PayPal capture ${result.captureId} (${result.amount?.value ?? ''} ${result.amount?.currency_code ?? ''})`, now()
      ]);
    }
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: `paypal capture failed: ${e.message}` });
  }
});

// Landing pages after the PayPal approval window (desktop app polls capture)
platformRouter.get('/billing/paypal/return', (req, res) => {
  res.send('<body style="font-family:sans-serif;background:#08080a;color:#f4f4f5;display:grid;place-items:center;height:100vh"><div style="text-align:center"><h2>✓ Payment approved</h2><p>Return to Ember Desktop — it will finish the capture automatically.</p><p style="opacity:.5;font-size:12px">token: ' + String(req.query.token ?? '').replace(/[^\w-]/g, '') + '</p></div></body>');
});
platformRouter.get('/billing/paypal/cancel', (_req, res) => {
  res.send('<body style="font-family:sans-serif;background:#08080a;color:#f4f4f5;display:grid;place-items:center;height:100vh"><div style="text-align:center"><h2>Payment cancelled</h2><p>No charge was made. You can close this window.</p></div></body>');
});

platformRouter.post('/billing/portal', (_req, res) => {
  res.status(501).json({
    error: 'Self-serve portal pending',
    detail: 'Subscription management (change plan, cancel) happens in Ember Desktop → Billing; PayPal subscription agreements land with the Braintree integration.'
  });
});

platformRouter.get('/billing/history', (_req, res) => {
  // Invoices come from Stripe once configured; local usage events meanwhile.
  res.json({ invoices: [], note: 'Invoices appear here after Stripe is configured.' });
});

// ---------- team ----------
platformRouter.get('/team', async (req, res) => {
  const workspaceId = req.query.workspaceId ?? null;
  const members = workspaceId
    ? all('SELECT * FROM team_members WHERE workspace_id = ?', [workspaceId])
    : all('SELECT * FROM team_members');
  let shaped = members.map((m) => ({ id: m.id, workspaceId: m.workspace_id, email: m.email, role: m.role, status: m.status, invitedAt: m.invited_at }));

  // merge cloud members (Supabase) — cloud workspace owners appear even on a fresh local DB
  if (supabaseEnabled) {
    try {
      const cloud = (await cloudTeam()) ?? [];
      const known = new Set(shaped.map((m) => m.email));
      for (const m of cloud) {
        if (!known.has(m.email)) {
          shaped.push({ id: m.id, workspaceId: m.workspace_id, email: m.email, role: m.role, status: m.status, invitedAt: m.invited_at, cloud: true });
        }
      }
    } catch { /* cloud unreachable — local list is still authoritative */ }
  }
  res.json({ roles: TEAM_ROLES, members: shaped });
});

platformRouter.post('/team/invite', (req, res) => {
  const { workspaceId = null, email, role = 'viewer' } = req.body ?? {};
  if (!email) return res.status(400).json({ error: 'email is required' });
  if (!TEAM_ROLES.includes(role)) return res.status(400).json({ error: `role must be one of ${TEAM_ROLES.join(', ')}` });
  let wsId = workspaceId ?? get('SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1')?.id;
  if (!wsId) {
    wsId = makeId('ws');
    run('INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)', [wsId, 'Local Workspace', now()]);
  }
  const id = makeId('tm');
  run('INSERT INTO team_members (id, workspace_id, email, role, status, invited_at) VALUES (?, ?, ?, ?, ?, ?)', [
    id, wsId, String(email).toLowerCase(), role, 'invited', now()
  ]);
  mirrorInvite({ id, workspaceId: 'ws_ember_hq', email: String(email).toLowerCase(), role, status: 'invited' });
  run('INSERT INTO notifications (id, type, title, body, created_at) VALUES (?, ?, ?, ?, ?)', [
    makeId('ntf'), 'teammate-invited', `Invitation sent to ${email}`, `Role: ${role}. Email delivery is a placeholder until SMTP is configured.`, now()
  ]);
  res.status(201).json({ id, email, role, status: 'invited', note: 'Invite stored. Email delivery pending SMTP configuration (placeholder).' });
});

// ---------- exports / imports ----------
platformRouter.get('/exports', (_req, res) => {
  res.json(all('SELECT * FROM exports ORDER BY created_at DESC LIMIT 100').map((e) => ({ id: e.id, kind: e.kind, format: e.format, status: e.status, createdAt: e.created_at })));
});

platformRouter.post('/exports', (req, res) => {
  const { kind = 'report', format = 'json', payload = {} } = req.body ?? {};
  if (format === 'pdf') {
    return res.status(501).json({ error: 'PDF export is planned — use json or markdown for now.' });
  }
  const id = makeId('exp');
  run('INSERT INTO exports (id, kind, format, status, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)', [
    id, kind, format, 'completed', now(), JSON.stringify(payload)
  ]);
  res.status(201).json({ id, kind, format, status: 'completed' });
});

platformRouter.post('/imports', (req, res) => {
  const { kind, payload } = req.body ?? {};
  const supported = ['ember-config', 'report', 'bug-list', 'test-plan', 'settings', 'logs'];
  if (!supported.includes(kind)) return res.status(400).json({ error: `kind must be one of ${supported.join(', ')}` });
  if (payload === undefined) return res.status(400).json({ error: 'payload is required' });

  const id = makeId('imp');
  let result = { imported: 0 };
  try {
    if (kind === 'report' && payload.id) {
      run('INSERT OR REPLACE INTO reports (id, project_id, test_run_id, generated_at, summary, metrics_json, report_json) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        payload.id, payload.projectId ?? null, null, payload.generatedAt ?? now(), payload.executiveSummary ?? null,
        JSON.stringify(payload.metrics ?? {}), JSON.stringify(payload)
      ]);
      result = { imported: 1, reportId: payload.id };
    } else if (kind === 'bug-list' && Array.isArray(payload)) {
      for (const b of payload) {
        if (!b?.title) continue;
        run(`INSERT OR REPLACE INTO bugs (id, project_id, title, severity, category, source, status, evidence, created_at, updated_at, detail_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          b.id ?? makeId('bug'), b.projectId ?? null, b.title, b.severity ?? 'medium', b.category ?? 'gameplay',
          b.source ?? 'manual-report', b.status ?? 'open', b.evidence ?? null, b.createdAt ?? now(), now(), JSON.stringify(b)
        ]);
        result.imported++;
      }
    } else if (kind === 'test-plan' && payload.name) {
      const tpId = makeId('tp');
      run('INSERT INTO test_plans (id, project_id, name, description, checks_json, commands_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        tpId, payload.projectId ?? null, payload.name, payload.description ?? '', JSON.stringify(payload.checks ?? []), JSON.stringify(payload.commands ?? []), now(), now()
      ]);
      result = { imported: 1, testPlanId: tpId };
    } else if (kind === 'settings' && typeof payload === 'object') {
      for (const [key, value] of Object.entries(payload)) {
        run('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at', [
          key, JSON.stringify(value), now()
        ]);
        result.imported++;
      }
    } else {
      result = { imported: 0, note: `Payload stored for kind "${kind}" (config/log imports are consumed by the desktop app).` };
    }
    run('INSERT INTO imports (id, kind, status, created_at, payload_json, result_json) VALUES (?, ?, ?, ?, ?, ?)', [
      id, kind, 'completed', now(), JSON.stringify(payload).slice(0, 500000), JSON.stringify(result)
    ]);
    res.status(201).json({ id, kind, status: 'completed', result });
  } catch (e) {
    run('INSERT INTO imports (id, kind, status, created_at, payload_json, result_json) VALUES (?, ?, ?, ?, ?, ?)', [
      id, kind, 'failed', now(), '{}', JSON.stringify({ error: e.message })
    ]);
    run('INSERT INTO notifications (id, type, title, body, created_at) VALUES (?, ?, ?, ?, ?)', [
      makeId('ntf'), 'import-failed', `Import failed (${kind})`, e.message, now()
    ]);
    res.status(500).json({ id, kind, status: 'failed', error: e.message });
  }
});

// ---------- sharing ----------
platformRouter.post('/reports/:id/share', (req, res) => {
  const report = get('SELECT id FROM reports WHERE id = ?', [req.params.id]);
  if (!report) return res.status(404).json({ error: 'report not found' });
  const { visibility = 'private' } = req.body ?? {};
  const id = makeId('shr');
  const token = visibility === 'public' ? randomBytes(16).toString('hex') : null;
  run('INSERT INTO shared_reports (id, report_id, visibility, share_token, created_at) VALUES (?, ?, ?, ?, ?)', [
    id, req.params.id, visibility, token, now()
  ]);
  res.status(201).json({ id, reportId: req.params.id, visibility, shareUrl: token ? `/shared/${token}` : null });
});

platformRouter.get('/shared/:token', (req, res) => {
  const share = get('SELECT * FROM shared_reports WHERE share_token = ? AND visibility = ?', [req.params.token, 'public']);
  if (!share) return res.status(404).json({ error: 'shared report not found' });
  const report = get('SELECT report_json FROM reports WHERE id = ?', [share.report_id]);
  res.json(j(report?.report_json, {}));
});

// ---------- notifications ----------
platformRouter.get('/notifications', (_req, res) => {
  res.json(all('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100').map((n) => ({
    id: n.id, type: n.type, title: n.title, body: n.body, read: !!n.read, createdAt: n.created_at
  })));
});

platformRouter.post('/notifications/:id/read', (req, res) => {
  run('UPDATE notifications SET read = 1 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ---------- usage metrics (real counts from the database) ----------
platformRouter.get('/usage', (_req, res) => {
  const count = (sql, params = []) => get(sql, params)?.n ?? 0;
  res.json({
    projectsConnected: count('SELECT COUNT(*) AS n FROM projects WHERE archived = 0'),
    testPlansCreated: count('SELECT COUNT(*) AS n FROM test_plans'),
    testRunsCompleted: count("SELECT COUNT(*) AS n FROM test_runs WHERE status = 'completed'"),
    bugsFound: count('SELECT COUNT(*) AS n FROM bugs'),
    criticalBugs: count("SELECT COUNT(*) AS n FROM bugs WHERE severity = 'critical'"),
    openBugs: count("SELECT COUNT(*) AS n FROM bugs WHERE status = 'open'"),
    reportsGenerated: count('SELECT COUNT(*) AS n FROM reports'),
    reportsExported: count('SELECT COUNT(*) AS n FROM exports'),
    agentEvents: count('SELECT COUNT(*) AS n FROM agent_events'),
    teamMembers: count('SELECT COUNT(*) AS n FROM team_members')
  });
});
