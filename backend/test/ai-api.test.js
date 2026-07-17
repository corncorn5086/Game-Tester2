/**
 * Managed AI API tests. Provider traffic is intercepted locally: no billed
 * external request is made, and the server-only credential is asserted never
 * to appear in an Ember API response.
 */
import assert from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SERVER_KEY = 'server-only-openai-test-key';
process.env.EMBER_DATA_DIR = mkdtempSync(join(tmpdir(), 'ember-ai-db-'));
process.env.EMBER_AI_PROVIDER = 'openai';
process.env.EMBER_AI_RATE_LIMIT_PER_MINUTE = '20';
process.env.EMBER_AI_IP_RATE_LIMIT_PER_MINUTE = '50';
process.env.EMBER_AI_CONCURRENCY_LIMIT = '2';
process.env.OPENAI_API_KEY = SERVER_KEY;
delete process.env.ANTHROPIC_API_KEY;

const nativeFetch = globalThis.fetch;
const providerRequests = [];
let markHeldProviderStarted;
let releaseHeldProvider;
const heldProviderStarted = new Promise((resolve) => { markHeldProviderStarted = resolve; });
let markCancellationProviderStarted;
let cancellationReachedProvider = false;
let cancellationReachedProviderAbort = false;
const cancellationProviderStarted = new Promise((resolve) => { markCancellationProviderStarted = resolve; });
globalThis.fetch = async (url, options = {}) => {
  if (String(url) !== 'https://api.openai.com/v1/responses') {
    return nativeFetch(url, options);
  }
  providerRequests.push({ url: String(url), options });
  const input = JSON.parse(options.body).input;
  if (input.includes('PROVIDER_FAIL')) {
    return new Response(JSON.stringify({ error: { message: `Rejected ${SERVER_KEY}` } }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    });
  }
  if (input.includes('CONCURRENCY_WAIT')) {
    markHeldProviderStarted();
    await new Promise((resolve, reject) => {
      releaseHeldProvider = resolve;
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  }
  if (input.includes('CANCEL_WAIT')) {
    cancellationReachedProvider = true;
    markCancellationProviderStarted();
    await new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        cancellationReachedProviderAbort = true;
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  }
  const isTriage = input.includes('STRICT JSON only');
  const isReadiness = input === 'Connection check for Ember QA. Reply with exactly: EMBER_OK';
  const text = isReadiness
    ? 'EMBER_OK'
    : isTriage
    ? JSON.stringify({
        insufficientInfo: false,
        insufficientReason: null,
        rootCause: 'A null reference reaches the movement path.',
        fix: 'Guard the reference and initialize it before movement.',
        reproSteps: ['Launch the scene', 'Trigger movement after respawn'],
        priorityScore: 92,
        priorityLabel: 'P1 - Critical',
        devMessage: 'Guard Player.gd line 42 before calling movement.'
      })
    : 'One critical crash pattern was found and should be fixed before release.';
  return new Response(JSON.stringify({
    id: `resp_test_${providerRequests.length}`,
    model: 'gpt-5.6-terra',
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const { createApp } = await import('../src/server.js');
const {
  aiRateLimitStats,
  cleanupAIRateLimitsForTest,
  resetAIRateLimits
} = await import('../src/routes/ai.js');
resetAIRateLimits();

const app = createApp();
const server = app.listen(0);
await app.locals.aiReadinessPromise;
assert.equal(providerRequests.length, 1, 'startup performs exactly one provider smoke test');
const readinessRequest = JSON.parse(providerRequests[0].options.body);
assert.equal(readinessRequest.input, 'Connection check for Ember QA. Reply with exactly: EMBER_OK');
assert.equal(readinessRequest.max_output_tokens, 16);
assert.equal(readinessRequest.reasoning.effort, 'none');
providerRequests.length = 0;
const base = `http://localhost:${server.address().port}`;

async function api(method, path, body, token, extraHeaders = {}) {
  const res = await nativeFetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extraHeaders
    },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text, headers: res.headers };
}

try {
  const signup = await api('POST', '/auth/signup', {
    email: 'managed-ai@studio.gg',
    password: 'Hunter2Hunter2',
    name: 'Managed AI Tester',
    username: 'managedai',
    tosAccepted: true
  });
  assert.equal(signup.status, 201);
  const token = signup.body.token;
  const secondSignup = await api('POST', '/auth/signup', {
    email: 'managed-ai-2@studio.gg',
    password: 'Hunter2Hunter2',
    name: 'Managed AI Tester 2',
    username: 'managedai2',
    tosAccepted: true
  });
  assert.equal(secondSignup.status, 201);
  const secondToken = secondSignup.body.token;

  const publicStatus = await api('GET', '/ai/status');
  const { readiness, ...publicStatusFields } = publicStatus.body;
  assert.deepEqual(publicStatusFields, {
    managed: true,
    enabled: true,
    provider: 'openai',
    model: 'gpt-5.6-terra',
    requiresAuthentication: true,
    authenticated: false,
    authorized: false,
    message: 'Sign in to use Ember AI.',
    reason: 'authentication_required'
  });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.state, 'ready');
  assert.match(readiness.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(publicStatus.text.includes(SERVER_KEY), false);

  const authStatus = await api('GET', '/ai/status', undefined, token);
  assert.equal(authStatus.body.authenticated, true);
  assert.equal(authStatus.body.authorized, true);
  assert.equal(authStatus.body.reason, undefined);

  const report = {
    id: 'report-managed-ai',
    project: { name: 'Space Miner', engine: 'godot' },
    metrics: {
      filesScanned: 12,
      logsAnalyzed: 1,
      bugsFound: 1,
      severityBreakdown: { critical: 1, high: 0, medium: 0, low: 0 },
      crashRisk: 'high',
      buildHealth: 'at risk',
      regressionRisk: 'high'
    },
    blockers: [],
    bugs: [{
      id: 'bug-managed-ai',
      title: 'Null movement reference',
      severity: 'critical',
      category: 'crash',
      source: 'code-analysis',
      evidence: 'Player.gd:42 movement target was null',
      filesInvolved: ['Player.gd'],
      stepsToReproduce: ['Launch', 'Respawn', 'Move']
    }]
  };

  const unauthenticated = await api('POST', '/ai/summary', { report });
  assert.equal(unauthenticated.status, 401);
  assert.equal(providerRequests.length, 0);

  const rejectedCredential = await api('POST', '/ai/summary', { report, apiKey: 'client-key' }, token);
  assert.equal(rejectedCredential.status, 400);
  assert.equal(rejectedCredential.body.code, 'CLIENT_AI_CREDENTIALS_NOT_ACCEPTED');
  assert.equal(providerRequests.length, 0);

  const summary = await api('POST', '/ai/summary', { report }, token);
  assert.equal(summary.status, 200);
  assert.equal(summary.body.ok, true);
  assert.equal(summary.body.managed, true);
  assert.equal(summary.body.provider, 'openai');
  assert.equal(summary.body.text.includes('critical crash'), true);
  assert.equal(summary.text.includes(SERVER_KEY), false);

  const analyze = await api('POST', '/ai/analyze', { report, maxBugs: 1 }, token);
  assert.equal(analyze.status, 200);
  assert.equal(analyze.body.ok, true);
  assert.equal(analyze.body.summary.ok, true);
  assert.equal(analyze.body.triage.length, 1);
  assert.equal(analyze.body.triage[0].bugId, 'bug-managed-ai');
  assert.equal(analyze.body.triage[0].rootCause.includes('null reference'), true);
  assert.equal(analyze.text.includes(SERVER_KEY), false);

  assert.equal(providerRequests.length, 3);
  for (const request of providerRequests) {
    assert.equal(request.options.headers.authorization, `Bearer ${SERVER_KEY}`);
    const providerBody = JSON.parse(request.options.body);
    assert.equal(providerBody.store, false);
    assert.equal(providerBody.model, 'gpt-5.6-terra');
  }

  const malformed = await api('POST', '/ai/summary', '{', token);
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.code, 'INVALID_JSON');

  const invalidReport = await api('POST', '/ai/summary', {
    report: { project: {}, metrics: {}, bugs: [] }
  }, token);
  assert.equal(invalidReport.status, 400);
  assert.equal(invalidReport.body.code, 'INVALID_AI_REPORT');

  const oversized = await api('POST', '/ai/summary', JSON.stringify({ report, padding: 'x'.repeat(530_000) }), token);
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.code, 'REQUEST_TOO_LARGE');

  const failingReport = structuredClone(report);
  failingReport.project.name = 'PROVIDER_FAIL';
  const providerFailure = await api('POST', '/ai/summary', { report: failingReport }, token);
  assert.equal(providerFailure.status, 503);
  assert.equal(providerFailure.body.code, 'AI_PROVIDER_ERROR');
  assert.equal(providerFailure.text.includes(SERVER_KEY), false);

  // A single user cannot fan out costly provider requests in parallel.
  process.env.EMBER_AI_CONCURRENCY_LIMIT = '1';
  resetAIRateLimits();
  const heldReport = structuredClone(report);
  heldReport.project.name = 'CONCURRENCY_WAIT';
  const heldRequest = api('POST', '/ai/summary', { report: heldReport }, token);
  await heldProviderStarted;
  const concurrent = await api('POST', '/ai/summary', { report }, token);
  assert.equal(concurrent.status, 429);
  assert.equal(concurrent.body.code, 'AI_CONCURRENCY_LIMITED');
  assert.equal(concurrent.headers.get('retry-after'), '1');
  releaseHeldProvider();
  assert.equal((await heldRequest).status, 200);

  // Closing the client request cancels the paid upstream request and frees the slot.
  resetAIRateLimits();
  const cancelledReport = structuredClone(report);
  cancelledReport.project.name = 'CANCEL_WAIT';
  const controller = new AbortController();
  const cancelledClientRequest = nativeFetch(base + '/ai/summary', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ report: cancelledReport }),
    signal: controller.signal
  }).catch((error) => error);
  await cancellationProviderStarted;
  controller.abort();
  const cancelledClientResult = await cancelledClientRequest;
  assert.equal(cancelledClientResult.name, 'AbortError');
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(cancellationReachedProvider, true);
  assert.equal(cancellationReachedProviderAbort, true);
  assert.equal((await api('POST', '/ai/summary', { report }, token)).status, 200);

  // The fixed-window per-user quota also carries a Retry-After hint.
  process.env.EMBER_AI_CONCURRENCY_LIMIT = '2';
  process.env.EMBER_AI_RATE_LIMIT_PER_MINUTE = '1';
  resetAIRateLimits();
  assert.equal((await api('POST', '/ai/summary', { report }, token)).status, 200);
  const rateLimited = await api('POST', '/ai/summary', { report }, token);
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.body.code, 'AI_RATE_LIMITED');
  assert.ok(Number(rateLimited.headers.get('retry-after')) >= 1);

  // Expired user/IP windows are removed, not retained for the process lifetime.
  process.env.EMBER_AI_RATE_LIMIT_PER_MINUTE = '20';
  process.env.EMBER_AI_IP_RATE_LIMIT_PER_MINUTE = '50';
  process.env.EMBER_AI_RATE_LIMIT_MAX_ENTRIES = '100';
  resetAIRateLimits();
  assert.equal((await api('POST', '/ai/summary', { report }, token)).status, 200);
  assert.equal((await api('POST', '/ai/summary', { report }, secondToken)).status, 200);
  assert.deepEqual(aiRateLimitStats(), { users: 2, ips: 1, active: 0 });
  cleanupAIRateLimitsForTest(Date.now() + 61_000);
  assert.deepEqual(aiRateLimitStats(), { users: 0, ips: 0, active: 0 });

  // The tracking maps remain bounded even under a stream of new accounts.
  process.env.EMBER_AI_RATE_LIMIT_MAX_ENTRIES = '1';
  resetAIRateLimits();
  assert.equal((await api('POST', '/ai/summary', { report }, token)).status, 200);
  assert.equal((await api('POST', '/ai/summary', { report }, secondToken)).status, 200);
  assert.ok(aiRateLimitStats().users <= 1);
  assert.ok(aiRateLimitStats().ips <= 1);

  // Creating another free account cannot bypass the shared client-IP budget.
  process.env.EMBER_AI_RATE_LIMIT_MAX_ENTRIES = '100';
  process.env.EMBER_AI_IP_RATE_LIMIT_PER_MINUTE = '1';
  resetAIRateLimits();
  assert.equal((await api('POST', '/ai/summary', { report }, token, { 'x-forwarded-for': '198.51.100.10' })).status, 200);
  const ipLimited = await api('POST', '/ai/summary', { report }, secondToken, { 'x-forwarded-for': '203.0.113.20' });
  assert.equal(ipLimited.status, 429);
  assert.equal(ipLimited.body.code, 'AI_IP_RATE_LIMITED');
  assert.ok(Number(ipLimited.headers.get('retry-after')) >= 1);
} finally {
  server.close();
  globalThis.fetch = nativeFetch;
}

console.log('✓ managed AI backend tests passed');
