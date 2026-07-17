/**
 * Managed-provider readiness is a real, single startup request. Health and
 * status only read cached state, fail closed, and never create a paid loop.
 */
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'ember-ai-readiness-'));
const serverKey = 'server-only-readiness-key';
process.env.EMBER_DATA_DIR = dataDir;
process.env.EMBER_AI_PROVIDER = 'openai';
process.env.OPENAI_API_KEY = serverKey;
process.env.EMBER_AUTH_SIGNUP_RATE_LIMIT = '100';

const nativeFetch = globalThis.fetch;
let providerRequests = [];
let providerMode = 'pending';
let releasePendingProvider = null;

function providerResponse(text) {
  return new Response(JSON.stringify({
    id: `resp_readiness_${providerRequests.length}`,
    model: 'gpt-5.6-terra',
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = async (url, options = {}) => {
  if (String(url) !== 'https://api.openai.com/v1/responses') return nativeFetch(url, options);
  providerRequests.push({ url: String(url), options, body: JSON.parse(options.body) });
  if (providerMode === 'pending') {
    return new Promise((resolveProvider, rejectProvider) => {
      releasePendingProvider = (text = 'EMBER_OK') => resolveProvider(providerResponse(text));
      options.signal?.addEventListener('abort', () => {
        rejectProvider(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  }
  if (providerMode === 'invalid') return providerResponse(`EMBER_ALMOST_OK ${serverKey}`);
  return providerResponse('EMBER_OK');
};

const { createApp } = await import('../src/server.js');
const { db, closeDatabase } = await import('../src/db.js');
const { resetAIReadinessForTest } = await import('../src/ai-readiness.js');

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

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolveListening, rejectListening) => {
    if (server.listening) return resolveListening();
    server.once('listening', resolveListening);
    server.once('error', rejectListening);
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function api(base, method, path, body, token) {
  const response = await nativeFetch(base + path, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}

let firstServer;
let failedServer;
try {
  resetAIReadinessForTest();
  providerMode = 'pending';
  providerRequests = [];
  const pendingApp = createApp({ runtimeConfig });
  const pendingListener = await listen(pendingApp);
  firstServer = pendingListener.server;
  const firstBase = pendingListener.base;

  assert.equal(providerRequests.length, 1, 'startup begins one real provider request');
  assert.deepEqual(providerRequests[0].body, {
    model: 'gpt-5.6-terra',
    max_output_tokens: 16,
    input: 'Connection check for Ember QA. Reply with exactly: EMBER_OK',
    reasoning: { effort: 'none' },
    store: false
  });

  for (let index = 0; index < 3; index += 1) {
    const health = await api(firstBase, 'GET', '/health');
    assert.equal(health.status, 503);
    assert.equal(health.body.status, 'not-ready');
    assert.equal(health.body.ai.state, 'checking');
    assert.equal(health.body.ai.ready, false);
  }
  const pendingStatus = await api(firstBase, 'GET', '/ai/status');
  assert.equal(pendingStatus.body.enabled, false);
  assert.equal(pendingStatus.body.authorized, false);
  assert.equal(pendingStatus.body.reason, 'provider_validation_pending');
  assert.equal(providerRequests.length, 1, 'health and status never repeat the provider probe');

  const signup = await api(firstBase, 'POST', '/auth/signup', {
    email: 'ready@studio.gg',
    username: 'readiness_test',
    name: 'Readiness Test',
    password: 'StrongPass123',
    tosAccepted: true
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  db.prepare('UPDATE users SET email_verified = 1 WHERE email = ?').run('ready@studio.gg');
  const token = signup.body.token;
  const blocked = await api(firstBase, 'POST', '/ai/summary', {}, token);
  assert.equal(blocked.status, 503);
  assert.equal(blocked.body.code, 'AI_PROVIDER_VALIDATION_PENDING');
  assert.equal(providerRequests.length, 1, 'business routes cannot bypass pending readiness');

  releasePendingProvider('EMBER_OK\n');
  await pendingApp.locals.aiReadinessPromise;
  const readyHealth = await api(firstBase, 'GET', '/health');
  assert.equal(readyHealth.status, 200);
  assert.equal(readyHealth.body.status, 'ok');
  assert.equal(readyHealth.body.ai.state, 'ready');
  assert.equal(readyHealth.body.ai.ready, true);
  const readyStatus = await api(firstBase, 'GET', '/ai/status', undefined, token);
  assert.equal(readyStatus.body.enabled, true);
  assert.equal(readyStatus.body.authorized, true);
  assert.equal(readyStatus.body.reason, undefined);
  assert.equal(providerRequests.length, 1, 'settled readiness remains cached');

  await new Promise((resolveClose) => firstServer.close(resolveClose));
  firstServer = null;

  resetAIReadinessForTest();
  providerMode = 'invalid';
  providerRequests = [];
  const failedApp = createApp({ runtimeConfig });
  const failedListener = await listen(failedApp);
  failedServer = failedListener.server;
  await failedApp.locals.aiReadinessPromise;

  for (let index = 0; index < 3; index += 1) {
    const failedHealth = await api(failedListener.base, 'GET', '/health');
    assert.equal(failedHealth.status, 503);
    assert.equal(failedHealth.body.status, 'not-ready');
    assert.equal(failedHealth.body.ai.state, 'failed');
    assert.equal(failedHealth.body.ai.ready, false);
    assert.equal(failedHealth.text.includes(serverKey), false);
    assert.equal(failedHealth.text.includes('EMBER_ALMOST_OK'), false);
  }
  const failedStatus = await api(failedListener.base, 'GET', '/ai/status');
  assert.equal(failedStatus.body.enabled, false);
  assert.equal(failedStatus.body.authorized, false);
  assert.equal(failedStatus.body.reason, 'provider_validation_failed');
  assert.equal(failedStatus.text.includes(serverKey), false);
  assert.equal(failedStatus.text.includes('EMBER_ALMOST_OK'), false);
  const failedBlocked = await api(failedListener.base, 'POST', '/ai/summary', {}, token);
  assert.equal(failedBlocked.status, 503);
  assert.equal(failedBlocked.body.code, 'AI_PROVIDER_UNAVAILABLE');
  assert.equal(providerRequests.length, 1, 'a failed probe is cached without a retry loop');
} finally {
  if (firstServer) await new Promise((resolveClose) => firstServer.close(resolveClose));
  if (failedServer) await new Promise((resolveClose) => failedServer.close(resolveClose));
  globalThis.fetch = nativeFetch;
  closeDatabase();
  const target = resolve(dataDir);
  const safeRoot = resolve(tmpdir());
  if (!target.startsWith(safeRoot) || !target.includes('ember-ai-readiness-')) {
    throw new Error('Unsafe AI readiness test cleanup target');
  }
  rmSync(target, { recursive: true, force: true });
}

console.log('✓ managed AI readiness passed');
