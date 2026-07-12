/**
 * Backend API smoke tests against an in-process server with a temp database.
 * Run: npm test --workspace @ember/backend
 */
import assert from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.EMBER_DATA_DIR = mkdtempSync(join(tmpdir(), 'ember-db-'));
const { createApp } = await import('../src/server.js');

const server = createApp().listen(0);
const base = `http://localhost:${server.address().port}`;

async function api(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// health
const health = await api('GET', '/health');
assert.equal(health.status, 200);
assert.equal(health.body.status, 'ok');

// auth flow
const signup = await api('POST', '/auth/signup', { email: 'dev@studio.gg', password: 'Hunter2Hunter2', name: 'Dev', username: 'devstudio', tosAccepted: true });
assert.equal(signup.status, 201);
const token = signup.body.token;
const me = await api('GET', '/auth/me', undefined, token);
assert.equal(me.body.user.email, 'dev@studio.gg');
assert.equal(me.body.user.username, 'devstudio');
assert.ok(me.body.workspace.id);

// verification codes are NEVER returned in responses (EMBER_DEV_CODES unset)
assert.equal(signup.body.verifyCode, undefined);
assert.equal(signup.body.verification?.verifyCode, undefined);
assert.equal(signup.body.verification.delivery, 'server-log');

// signup requires ToS acceptance and a strong password
const noTos = await api('POST', '/auth/signup', { email: 'x@y.gg', password: 'Hunter2Hunter2', tosAccepted: false });
assert.equal(noTos.status, 400);
const weakPw = await api('POST', '/auth/signup', { email: 'x2@y.gg', password: 'alllowercase1', tosAccepted: true });
assert.equal(weakPw.status, 400);

// private routes reject anonymous callers
for (const [method, path] of [
  ['GET', '/projects'], ['POST', '/projects'], ['GET', '/bugs'], ['GET', '/reports'],
  ['POST', '/agent/report'], ['GET', '/settings'], ['PATCH', '/settings'],
  ['POST', '/billing/checkout'], ['POST', '/billing/paypal/capture'],
  ['GET', '/team'], ['POST', '/team/invite'], ['POST', '/exports'], ['POST', '/imports'],
  ['GET', '/notifications'], ['GET', '/usage']
]) {
  const anon = await api(method, path, method === 'GET' ? undefined : {});
  assert.equal(anon.status, 401, `${method} ${path} must require auth (got ${anon.status})`);
}

// forgot-password never leaks reset tokens and is rate limited (5/window)
for (let i = 0; i < 5; i++) {
  const fp = await api('POST', '/auth/forgot-password', { email: 'dev@studio.gg' });
  assert.equal(fp.status, 200);
  assert.equal(fp.body.resetToken, undefined, 'reset token must not be in the response');
}
const limited = await api('POST', '/auth/forgot-password', { email: 'dev@studio.gg' });
assert.equal(limited.status, 429);

// profile update + change password
const patch = await api('PATCH', '/auth/me', { role: 'Studio lead', goal: 'Ship faster' }, token);
assert.equal(patch.body.user.role, 'Studio lead');
const chpw = await api('POST', '/auth/change-password', { currentPassword: 'Hunter2Hunter2', newPassword: 'Newpass88X' }, token);
assert.equal(chpw.status, 200);

const badLogin = await api('POST', '/auth/login', { email: 'dev@studio.gg', password: 'wrong' });
assert.equal(badLogin.status, 401);

// projects
const project = await api('POST', '/projects', { name: 'Space Miner', engine: 'godot' }, token);
assert.equal(project.status, 201);
const projectId = project.body.id;
const fetched = await api('GET', `/projects/${projectId}`, undefined, token);
assert.equal(fetched.body.name, 'Space Miner');

// test plans with validation
const badPlan = await api('POST', '/test-plans', { name: 'Bad', checks: ['nonexistent-check'] }, token);
assert.equal(badPlan.status, 400);
const plan = await api('POST', '/test-plans', { projectId, name: 'Smoke', checks: ['scan', 'analyze', 'logs'] }, token);
assert.equal(plan.status, 201);

// test runs lifecycle
const runRes = await api('POST', '/test-runs', { projectId, testPlanId: plan.body.id, profile: 'smoke' }, token);
assert.equal(runRes.body.status, 'queued');
await api('POST', `/test-runs/${runRes.body.id}/start`, undefined, token);
const done = await api('POST', `/test-runs/${runRes.body.id}/complete`, { status: 'completed', summary: { checksPassed: 3 } }, token);
assert.equal(done.body.status, 'completed');

// agent report ingestion → bugs created + notification
const report = {
  id: 'rpt_test1',
  generatedAt: new Date().toISOString(),
  executiveSummary: 'Test report',
  project: { name: 'Space Miner', engine: 'godot' },
  metrics: { bugsFound: 1, severityBreakdown: { critical: 1, high: 0, medium: 0, low: 0 } },
  bugs: [{
    id: 'bug_test1', title: 'Null instance call in Player.gd', severity: 'critical', category: 'crash',
    source: 'logs', evidence: 'Attempt to call function move on a null instance', status: 'open',
    reproducibilityConfidence: 'high', regressionRisk: 'high', createdAt: new Date().toISOString(),
    filesInvolved: ['Player.gd'], logsInvolved: ['godot.log'], stepsToReproduce: ['Launch', 'Die twice']
  }]
};
const ingest = await api('POST', '/agent/report', { projectId, report }, token);
assert.equal(ingest.status, 201);
assert.equal(ingest.body.bugsIngested, 1);

const bugs = await api('GET', `/bugs?projectId=${projectId}&severity=critical`, undefined, token);
assert.equal(bugs.body.length, 1);
assert.equal(bugs.body[0].filesInvolved[0], 'Player.gd');

const patched = await api('PATCH', `/bugs/${bugs.body[0].id}`, { status: 'investigating' }, token);
assert.equal(patched.body.status, 'investigating');

const gotReport = await api('GET', '/reports/rpt_test1', undefined, token);
assert.equal(gotReport.body.executiveSummary, 'Test report');

const notifications = await api('GET', '/notifications', undefined, token);
assert.ok(notifications.body.some((n) => n.type === 'critical-bug-found'));

// billing
const plans = await api('GET', '/billing/plans');
assert.equal(plans.body.length, 5);
const providers = await api('GET', '/billing/providers');
assert.ok(providers.body.some((p) => p.id === 'paypal'));
const checkout = await api('POST', '/billing/checkout', { planId: 'pro', provider: 'paypal' }, token);
assert.equal(checkout.status, 501); // PayPal keys not set → explicit, not fake
const walletCheckout = await api('POST', '/billing/checkout', { planId: 'pro', provider: 'apple-pay' }, token);
assert.equal(walletCheckout.status, 501); // wallet needs Braintree → explicit

// team
const invite = await api('POST', '/team/invite', { email: 'qa@studio.gg', role: 'qa' }, token);
assert.equal(invite.status, 201);
const team = await api('GET', '/team', undefined, token);
assert.ok(team.body.members.some((m) => m.email === 'qa@studio.gg'));

// exports/imports
const exportRes = await api('POST', '/exports', { kind: 'report', format: 'json', payload: { reportId: 'rpt_test1' } }, token);
assert.equal(exportRes.status, 201);
const pdfExport = await api('POST', '/exports', { kind: 'report', format: 'pdf' }, token);
assert.equal(pdfExport.status, 501);
const importRes = await api('POST', '/imports', { kind: 'bug-list', payload: [{ title: 'Imported bug', severity: 'low' }] }, token);
assert.equal(importRes.body.result.imported, 1);

// sharing
const share = await api('POST', '/reports/rpt_test1/share', { visibility: 'public' }, token);
assert.ok(share.body.shareUrl);
const shared = await api('GET', share.body.shareUrl.replace('/shared/', '/shared/'));
assert.equal(shared.body.id, 'rpt_test1');

// usage metrics reflect reality
const usage = await api('GET', '/usage', undefined, token);
assert.equal(usage.body.projectsConnected, 1);
assert.ok(usage.body.bugsFound >= 2);

server.close();
console.log('✓ backend API tests passed');
