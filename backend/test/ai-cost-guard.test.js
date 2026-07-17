/**
 * Paid-provider cost guard tests. Provider traffic is mocked locally; the
 * durable counters use an isolated SQLite database and no external call is
 * made.
 */
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'ember-ai-cost-'));
process.env.NODE_ENV = 'production';
process.env.EMBER_DATA_DIR = dataDir;
process.env.EMBER_PUBLIC_SIGNUP = 'true';
process.env.EMBER_AI_PROVIDER = 'openai';
process.env.OPENAI_API_KEY = 'server-only-cost-test-key';
process.env.EMBER_AI_ALLOWED_EMAILS = ' ALLOWED@studio.gg, global@studio.gg ';
process.env.EMBER_AI_RATE_LIMIT_PER_MINUTE = '100';
process.env.EMBER_AI_IP_RATE_LIMIT_PER_MINUTE = '100';
process.env.EMBER_AI_CONCURRENCY_LIMIT = '10';
process.env.EMBER_AI_GLOBAL_CONCURRENCY_LIMIT = '4';
process.env.EMBER_AI_GLOBAL_OPERATIONS_PER_MINUTE = '100';
process.env.EMBER_AI_DAILY_USER_OPERATION_LIMIT = '4';
process.env.EMBER_AI_DAILY_GLOBAL_OPERATION_LIMIT = '10';
process.env.EMBER_AI_BUDGET_RETENTION_DAYS = '8';
process.env.EMBER_AUTH_SIGNUP_RATE_LIMIT = '100';

const nativeFetch = globalThis.fetch;
let providerCalls = 0;
globalThis.fetch = async (url, options = {}) => {
  if (String(url) !== 'https://api.openai.com/v1/responses') return nativeFetch(url, options);
  providerCalls += 1;
  const input = JSON.parse(options.body).input;
  const text = input === 'Connection check for Ember QA. Reply with exactly: EMBER_OK'
    ? 'EMBER_OK'
    : input.includes('STRICT JSON only')
    ? JSON.stringify({
        insufficientInfo: false,
        insufficientReason: null,
        rootCause: 'A shared reference can be null.',
        fix: 'Initialize and guard the reference.',
        reproSteps: ['Launch the scene', 'Trigger the action'],
        priorityScore: 80,
        priorityLabel: 'P1 - High',
        devMessage: 'Guard the reference before use.'
      })
    : 'The report contains several release risks that need attention.';
  return new Response(JSON.stringify({
    id: `resp_cost_${providerCalls}`,
    model: 'gpt-5.6-terra',
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const { createApp } = await import('../src/server.js');
const { db, closeDatabase } = await import('../src/db.js');
const {
  AICostLimitError,
  aiDailyUsageForTest,
  beginProviderOperation,
  clearAIDailyUsageForTest,
  hasProductionAIAccess,
  resetAICostRuntimeState
} = await import('../src/ai-cost-guard.js');
const { resetAIRateLimits } = await import('../src/routes/ai.js');

const runtimeConfig = Object.freeze({
  production: true,
  host: '127.0.0.1',
  port: 0,
  apiUrl: null,
  dataDir,
  trustProxy: false,
  corsOrigins: Object.freeze([]),
  aiProvider: 'openai',
  apiMode: 'managed-ai',
  publicSignup: true,
  shutdownTimeoutMs: 5_000
});
const app = createApp({ runtimeConfig });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolveListening, rejectListening) => {
  if (server.listening) return resolveListening();
  server.once('listening', resolveListening);
  server.once('error', rejectListening);
});
await app.locals.aiReadinessPromise;
assert.equal(providerCalls, 1, 'startup performs one provider readiness request');
providerCalls = 0;
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;

async function api(method, path, body, token) {
  const response = await nativeFetch(base + path, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  return { status: response.status, body: payload, headers: response.headers };
}

async function signup(email, username) {
  const result = await api('POST', '/auth/signup', {
    email,
    username,
    name: username,
    password: 'StrongPass123',
    tosAccepted: true
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.token;
}

function completeReport() {
  const severities = ['critical', 'high', 'medium'];
  return {
    project: { name: 'Cost Guard Game', engine: 'godot' },
    metrics: {
      severityBreakdown: { critical: 1, high: 1, medium: 1, low: 0 },
      crashRisk: 'high',
      buildHealth: 'at risk',
      regressionRisk: 'medium'
    },
    blockers: [],
    bugs: severities.map((severity, index) => ({
      id: `bug-cost-${index + 1}`,
      title: `Issue ${index + 1}`,
      severity,
      category: 'runtime',
      source: 'code-analysis',
      evidence: `Evidence ${index + 1}`
    }))
  };
}

try {
  resetAIRateLimits();
  clearAIDailyUsageForTest();
  assert.equal(
    hasProductionAIAccess({ email: 'not-listed@studio.gg', email_verified: 1 }, runtimeConfig),
    true,
    'a verified production account does not need an allowlist entry'
  );
  assert.equal(
    hasProductionAIAccess({ email: 'allowed@studio.gg', email_verified: 0 }, runtimeConfig),
    false,
    'an allowlisted address never bypasses actual account verification'
  );
  const deniedToken = await signup('unverified@studio.gg', 'unverified');
  const allowlistedOnlyToken = await signup('allowed@studio.gg', 'alloweduser');
  const allowedToken = await signup('verified@studio.gg', 'verifieduser');
  const globalToken = await signup('global@studio.gg', 'globaluser');
  db.prepare('UPDATE users SET email_verified = 1 WHERE email IN (?, ?)')
    .run('verified@studio.gg', 'global@studio.gg');
  const report = completeReport();

  const deniedStatus = await api('GET', '/ai/status', undefined, deniedToken);
  assert.equal(deniedStatus.status, 200);
  assert.equal(deniedStatus.body.authenticated, true);
  assert.equal(deniedStatus.body.authorized, false);
  assert.equal(deniedStatus.body.reason, 'account_verification_required');
  assert.match(deniedStatus.body.message, /verify/i);

  const allowlistedOnlyStatus = await api('GET', '/ai/status', undefined, allowlistedOnlyToken);
  assert.equal(allowlistedOnlyStatus.body.authorized, false);
  assert.equal(allowlistedOnlyStatus.body.reason, 'account_verification_required');

  const allowedStatus = await api('GET', '/ai/status', undefined, allowedToken);
  assert.equal(allowedStatus.body.authorized, true, 'a verified account may use managed AI');

  const denied = await api('POST', '/ai/summary', { report }, deniedToken);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'AI_ACCOUNT_VERIFICATION_REQUIRED');
  assert.equal(providerCalls, 0, 'an unauthorized account never reaches the paid provider');

  const analyzed = await api('POST', '/ai/analyze', { report, maxBugs: 3 }, allowedToken);
  assert.equal(analyzed.status, 200, JSON.stringify(analyzed.body));
  assert.equal(analyzed.body.summary.ok, true);
  assert.equal(analyzed.body.triage.length, 3);
  assert.equal(providerCalls, 4, 'analyze counts one summary plus three real triage operations');

  const usage = aiDailyUsageForTest();
  const userUsage = usage.find((row) => row.scope === 'user');
  const globalUsage = usage.find((row) => row.scope === 'global');
  assert.deepEqual(
    {
      operations: userUsage.operations,
      summaryOperations: userUsage.summaryOperations,
      triageOperations: userUsage.triageOperations
    },
    { operations: 4, summaryOperations: 1, triageOperations: 3 }
  );
  assert.deepEqual(
    {
      operations: globalUsage.operations,
      summaryOperations: globalUsage.summaryOperations,
      triageOperations: globalUsage.triageOperations
    },
    { operations: 4, summaryOperations: 1, triageOperations: 3 }
  );

  // Process-local maps can be reset/restarted without erasing the SQLite day.
  resetAICostRuntimeState();
  const userBudget = await api('POST', '/ai/summary', { report }, allowedToken);
  assert.equal(userBudget.status, 429);
  assert.equal(userBudget.body.code, 'AI_DAILY_USER_BUDGET_EXCEEDED');
  assert.ok(Number(userBudget.headers.get('retry-after')) >= 1);
  assert.equal(providerCalls, 4);

  process.env.EMBER_AI_DAILY_USER_OPERATION_LIMIT = '100';
  process.env.EMBER_AI_DAILY_GLOBAL_OPERATION_LIMIT = '4';
  resetAICostRuntimeState();
  const globalBudget = await api('POST', '/ai/summary', { report }, globalToken);
  assert.equal(globalBudget.status, 429);
  assert.equal(globalBudget.body.code, 'AI_DAILY_GLOBAL_BUDGET_EXCEEDED');
  assert.equal(providerCalls, 4);

  // Global process guards are operation-based and independent of HTTP users.
  clearAIDailyUsageForTest();
  process.env.EMBER_AI_DAILY_USER_OPERATION_LIMIT = '100';
  process.env.EMBER_AI_DAILY_GLOBAL_OPERATION_LIMIT = '100';
  process.env.EMBER_AI_GLOBAL_CONCURRENCY_LIMIT = '1';
  process.env.EMBER_AI_GLOBAL_OPERATIONS_PER_MINUTE = '1';
  resetAICostRuntimeState();
  const fixedTime = Date.UTC(2026, 6, 17, 12, 0, 0);
  const permit = beginProviderOperation({ userId: 'unit-user', kind: 'summary', currentTime: fixedTime });
  assert.throws(
    () => beginProviderOperation({ userId: 'other-user', kind: 'summary', currentTime: fixedTime }),
    (error) => error instanceof AICostLimitError && error.code === 'AI_GLOBAL_CONCURRENCY_LIMITED'
  );
  permit.release();
  assert.throws(
    () => beginProviderOperation({ userId: 'other-user', kind: 'triage', currentTime: fixedTime }),
    (error) => error instanceof AICostLimitError && error.code === 'AI_GLOBAL_RATE_LIMITED'
  );

  // The first reservation of a new day removes rows outside retention.
  clearAIDailyUsageForTest();
  const oldDay = '2025-01-01';
  db.prepare(`
    INSERT INTO ai_daily_usage (
      day, scope, scope_id, operations, summary_operations, triage_operations, updated_at
    ) VALUES (?, 'user', 'old-user', 1, 1, 0, ?)
  `).run(oldDay, new Date(fixedTime).toISOString());
  process.env.EMBER_AI_BUDGET_RETENTION_DAYS = '2';
  process.env.EMBER_AI_GLOBAL_CONCURRENCY_LIMIT = '4';
  process.env.EMBER_AI_GLOBAL_OPERATIONS_PER_MINUTE = '100';
  resetAICostRuntimeState();
  const cleanupPermit = beginProviderOperation({ userId: 'cleanup-user', kind: 'triage', currentTime: fixedTime });
  cleanupPermit.release();
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ai_daily_usage WHERE day = ?').get(oldDay).count, 0);
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  globalThis.fetch = nativeFetch;
  closeDatabase();
  const target = resolve(dataDir);
  const safeRoot = resolve(tmpdir());
  if (!target.startsWith(safeRoot) || !target.includes('ember-ai-cost-')) {
    throw new Error('Unsafe AI cost test cleanup target');
  }
  rmSync(target, { recursive: true, force: true });
}

console.log('✓ managed AI cost guards passed');
