import assert from 'node:assert';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const testRoot = mkdtempSync(join(tmpdir(), 'ember-runtime-'));
process.env.EMBER_DATA_DIR = join(testRoot, 'database');

const {
  StartupConfigError,
  loadRuntimeConfig,
  parseCorsOrigins,
  parseTrustProxy
} = await import('../src/runtime-config.js');
const { createApp, shutdownServer } = await import('../src/server.js');
const { DATA_DIR, DB_PATH, closeDatabase, get } = await import('../src/db.js');
const { resetAuthRateLimits } = await import('../src/auth-security.js');

const productionEnv = {
  NODE_ENV: 'production',
  API_URL: 'https://api.ember.example',
  EMBER_DATA_DIR: resolve(process.env.EMBER_DATA_DIR),
  EMBER_TRUST_PROXY: '1',
  EMBER_CORS_ORIGINS: 'https://app.ember.example, https://admin.ember.example',
  EMBER_API_MODE: 'managed-ai',
  EMBER_AI_PROVIDER: 'openai',
  OPENAI_API_KEY: 'server-key'
};

function rejectsConfig(overrides, code) {
  assert.throws(
    () => loadRuntimeConfig({ ...productionEnv, ...overrides }),
    (error) => error instanceof StartupConfigError && error.code === code
  );
}

function rejectsStandaloneConfig(env, code) {
  assert.throws(
    () => loadRuntimeConfig(env),
    (error) => error instanceof StartupConfigError && error.code === code
  );
}

const development = loadRuntimeConfig({});
assert.equal(development.production, false);
assert.equal(development.host, '127.0.0.1');
assert.equal(development.port, 4310);
assert.equal(development.apiMode, 'full');
assert.equal(development.trustProxy, false);
assert.deepEqual(development.corsOrigins, ['*']);
assert.equal(development.dataDir, null);
assert.equal(development.publicSignup, true);

const localDevelopment = loadRuntimeConfig({
  NODE_ENV: 'development',
  API_URL: 'http://localhost:4310',
  HOST: '127.0.0.1'
});
assert.equal(localDevelopment.production, false);
assert.equal(localDevelopment.apiMode, 'full');
assert.deepEqual(localDevelopment.corsOrigins, ['*']);
assert.equal(loadRuntimeConfig({ NODE_ENV: 'test', API_URL: 'http://[::1]:4310' }).production, false);

// Any public bind/URL or Railway runtime signal must fail closed unless the
// process explicitly identifies itself as production.
for (const unsafeEnv of [
  { API_URL: 'https://api.ember.example' },
  { NODE_ENV: 'development', HOST: '0.0.0.0' },
  { NODE_ENV: 'test', HOST: '::' },
  { NODE_ENV: 'prod', HOST: '192.168.1.20' },
  { NODE_ENV: 'development', API_URL: 'http://10.0.0.20:4310' },
  { RAILWAY_ENVIRONMENT: 'production' },
  { NODE_ENV: 'staging', RAILWAY_PUBLIC_DOMAIN: 'ember.up.railway.app' },
  { NODE_ENV: 'development', RAILWAY_PROJECT_ID: 'project-id' }
]) {
  rejectsStandaloneConfig(unsafeEnv, 'PUBLIC_RUNTIME_REQUIRES_PRODUCTION');
}

const production = loadRuntimeConfig(productionEnv);
assert.equal(production.production, true);
assert.equal(production.host, '0.0.0.0');
assert.equal(production.apiMode, 'managed-ai');
assert.equal(production.trustProxy, 1);
assert.deepEqual(production.corsOrigins, ['https://app.ember.example', 'https://admin.ember.example']);
assert.equal(isAbsolute(production.dataDir), true);
assert.equal(production.publicSignup, false);
assert.equal(loadRuntimeConfig({ ...productionEnv, RAILWAY_PROJECT_ID: 'project-id' }).production, true);

rejectsConfig({ EMBER_DATA_DIR: '' }, 'PERSISTENT_DATA_DIR_REQUIRED');
rejectsConfig({ EMBER_DATA_DIR: 'relative/data' }, 'DATA_DIR_NOT_ABSOLUTE');
rejectsConfig({ API_URL: 'http://api.ember.example' }, 'PUBLIC_HTTPS_REQUIRED');
rejectsConfig({ API_URL: '' }, 'PUBLIC_HTTPS_URL_REQUIRED');
rejectsConfig({ EMBER_CORS_ORIGINS: '*' }, 'CORS_WILDCARD_FORBIDDEN');
rejectsConfig({ EMBER_CORS_ORIGINS: 'http://app.ember.example' }, 'CORS_HTTPS_REQUIRED');
rejectsConfig({ EMBER_TRUST_PROXY: '' }, 'TRUST_PROXY_REQUIRED');
rejectsConfig({ EMBER_TRUST_PROXY: 'true' }, 'TRUST_PROXY_TOO_BROAD');
rejectsConfig({ EMBER_API_MODE: '' }, 'API_MODE_REQUIRED');
rejectsConfig({ EMBER_API_MODE: 'full' }, 'API_MODE_UNSAFE');
rejectsConfig({ EMBER_AI_PROVIDER: 'auto', OPENAI_API_KEY: '' }, 'AI_PROVIDER_EXPLICIT_REQUIRED');
rejectsConfig({ EMBER_AI_PROVIDER: 'openai', OPENAI_API_KEY: '' }, 'AI_PROVIDER_KEY_REQUIRED');
rejectsConfig({ EMBER_AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: '' }, 'AI_PROVIDER_KEY_REQUIRED');
assert.equal(loadRuntimeConfig({ ...productionEnv, EMBER_PUBLIC_SIGNUP: 'true' }).publicSignup, true);
assert.deepEqual(loadRuntimeConfig({ ...productionEnv, EMBER_CORS_ORIGINS: '' }).corsOrigins, []);
assert.equal(parseTrustProxy('loopback, 10.0.0.0/8'), 'loopback, 10.0.0.0/8');
assert.deepEqual(parseCorsOrigins('', { production: true }), []);

assert.equal(DATA_DIR, resolve(process.env.EMBER_DATA_DIR));
assert.equal(DB_PATH, join(DATA_DIR, 'ember.sqlite'));
assert.equal(existsSync(DATA_DIR), true);
assert.equal(existsSync(DB_PATH), true);

const previousAIProvider = process.env.EMBER_AI_PROVIDER;
const previousOpenAIKey = process.env.OPENAI_API_KEY;
process.env.EMBER_AI_PROVIDER = 'openai';
process.env.OPENAI_API_KEY = 'server-key';
let readinessChecks = 0;
const app = createApp({
  runtimeConfig: production,
  aiConnectionCheck: async () => {
    readinessChecks += 1;
    return { ok: true, text: 'EMBER_OK', provider: 'openai', model: 'gpt-5.6-terra' };
  }
});
assert.equal(app.get('trust proxy'), 1);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolveListening, rejectListening) => {
  if (server.listening) return resolveListening();
  server.once('listening', resolveListening);
  server.once('error', rejectListening);
});
await app.locals.aiReadinessPromise;
assert.equal(readinessChecks, 1, 'production readiness is validated once without external traffic in this test');
const base = `http://127.0.0.1:${server.address().port}`;

// Production creates its first verified operator through a one-time server
// proof, not by temporarily opening public signup or trusting an email
// allowlist. The bootstrap response never exposes a bearer or provider token.
const bootstrapSecret = `ember-bootstrap-${'x'.repeat(32)}`;
process.env.EMBER_OPERATOR_BOOTSTRAP_EMAIL = 'operator@studio.gg';
process.env.EMBER_OPERATOR_BOOTSTRAP_SECRET = bootstrapSecret;
const bootstrapRequest = (secret) => fetch(`${base}/auth/bootstrap-operator`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-ember-bootstrap-secret': secret
  },
  body: JSON.stringify({
    email: 'operator@studio.gg',
    password: 'Hunter2Hunter2',
    name: 'Ember Operator',
    username: 'ember_operator',
    tosAccepted: true
  })
});
const rejectedBootstrap = await bootstrapRequest('wrong-bootstrap-secret-that-is-long');
assert.equal(rejectedBootstrap.status, 403);
assert.equal((await rejectedBootstrap.json()).code, 'OPERATOR_BOOTSTRAP_PROOF_INVALID');
assert.equal(get('SELECT id FROM users LIMIT 1'), undefined);
const completedBootstrap = await bootstrapRequest(bootstrapSecret);
assert.equal(completedBootstrap.status, 201);
const completedBootstrapBody = await completedBootstrap.json();
assert.equal(completedBootstrapBody.bootstrapComplete, true);
assert.equal(completedBootstrapBody.user.email, 'operator@studio.gg');
assert.equal(completedBootstrapBody.user.emailVerified, true);
assert.equal('token' in completedBootstrapBody, false);
assert.equal(JSON.stringify(completedBootstrapBody).includes(bootstrapSecret), false);
assert.equal(get('SELECT COUNT(*) AS count FROM sessions').count, 0);
assert.equal(get('SELECT user_id FROM operator_bootstrap WHERE singleton = 1').user_id, completedBootstrapBody.user.id);
const replayedBootstrap = await bootstrapRequest(bootstrapSecret);
assert.equal(replayedBootstrap.status, 409);
assert.equal((await replayedBootstrap.json()).code, 'OPERATOR_BOOTSTRAP_CLOSED');
delete process.env.EMBER_OPERATOR_BOOTSTRAP_EMAIL;
delete process.env.EMBER_OPERATOR_BOOTSTRAP_SECRET;

const operatorLogin = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'operator@studio.gg', password: 'Hunter2Hunter2' })
});
assert.equal(operatorLogin.status, 200, 'the operator signs in normally after bootstrap');

const health = await fetch(`${base}/health`, { headers: { origin: 'https://app.ember.example' } });
assert.equal(health.status, 200);
assert.equal(health.headers.get('access-control-allow-origin'), 'https://app.ember.example');
assert.equal(health.headers.get('vary'), 'Origin');
assert.equal('cloud' in await health.json(), false, 'public health does not expose cloud integration details');

const allowedPreflight = await fetch(`${base}/auth/login`, {
  method: 'OPTIONS',
  headers: {
    origin: 'https://app.ember.example',
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type, authorization'
  }
});
assert.equal(allowedPreflight.status, 204);
assert.equal(allowedPreflight.headers.get('access-control-allow-origin'), 'https://app.ember.example');

const deniedPreflight = await fetch(`${base}/auth/login`, {
  method: 'OPTIONS',
  headers: {
    origin: 'https://evil.example',
    'access-control-request-method': 'POST'
  }
});
assert.equal(deniedPreflight.status, 403);
assert.equal((await deniedPreflight.json()).code, 'CORS_ORIGIN_DENIED');

process.env.EMBER_AUTH_LOGIN_RATE_LIMIT = '1';
process.env.EMBER_AUTH_LOGIN_RATE_WINDOW_MS = '60000';
resetAuthRateLimits();
const wrongLogin = (forwardedFor) => fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
  body: JSON.stringify({ email: 'missing@example.com', password: 'WrongPass9' })
});
assert.equal((await wrongLogin('198.51.100.10')).status, 401);
assert.equal((await wrongLogin('203.0.113.20')).status, 401, 'trusted single-hop proxy keeps distinct client addresses');
assert.equal((await wrongLogin('198.51.100.10')).status, 429, 'the same forwarded client remains rate-limited');
delete process.env.EMBER_AUTH_LOGIN_RATE_LIMIT;
delete process.env.EMBER_AUTH_LOGIN_RATE_WINDOW_MS;
resetAuthRateLimits();

const signup = await fetch(`${base}/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: 'runtime-production@studio.gg',
    password: 'Hunter2Hunter2',
    name: 'Runtime Tester',
    tosAccepted: true
  })
});
assert.equal(signup.status, 403, 'public production signup fails closed by default');
assert.equal((await signup.json()).code, 'PUBLIC_SIGNUP_DISABLED');
assert.equal((await fetch(`${base}/auth/me`)).status, 401, 'authentication routes remain available in managed-ai mode');

// Operators can explicitly open signup, but verification secrets are still
// never reflected in production API responses.
const openSignupConfig = loadRuntimeConfig({ ...productionEnv, EMBER_PUBLIC_SIGNUP: 'true' });
const openSignupApp = createApp({ runtimeConfig: openSignupConfig });
const openSignupServer = openSignupApp.listen(0, '127.0.0.1');
await new Promise((resolveListening, rejectListening) => {
  if (openSignupServer.listening) return resolveListening();
  openSignupServer.once('listening', resolveListening);
  openSignupServer.once('error', rejectListening);
});
const openSignupBase = `http://127.0.0.1:${openSignupServer.address().port}`;
const allowedSignup = await fetch(`${openSignupBase}/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: 'runtime-production-enabled@studio.gg',
    password: 'Hunter2Hunter2',
    name: 'Runtime Enabled',
    tosAccepted: true
  })
});
assert.equal(allowedSignup.status, 201);
const allowedSignupBody = await allowedSignup.json();
assert.equal('verifyCode' in allowedSignupBody, false);
const resentCode = await fetch(`${openSignupBase}/auth/resend-email-code`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${allowedSignupBody.token}`
  },
  body: '{}'
});
assert.equal(resentCode.status, 200);
assert.equal('verifyCode' in await resentCode.json(), false);
await shutdownServer(openSignupServer, { closeResources: async () => {} });

assert.equal((await fetch(`${base}/ai/status`)).status, 200, 'managed AI status remains available');
assert.equal((await fetch(`${base}/projects`)).status, 404, 'legacy project API is not public in managed-ai mode');
assert.equal((await fetch(`${base}/billing/plans`)).status, 404, 'legacy billing API is not public in managed-ai mode');
assert.equal((await fetch(`${base}/cloud/health`)).status, 404, 'cloud diagnostics are not public in managed-ai mode');

app.locals.isShuttingDown = true;
const drainingHealth = await fetch(`${base}/health`);
assert.equal(drainingHealth.status, 503);
assert.equal((await drainingHealth.json()).status, 'shutting-down');

let resourcesClosed = false;
const shutdown = await shutdownServer(server, {
  timeoutMs: 2_000,
  closeResources: async () => { resourcesClosed = true; }
});
assert.deepEqual(shutdown, { forced: false });
assert.equal(resourcesClosed, true);
assert.equal(server.listening, false);

closeDatabase();
if (previousAIProvider == null) delete process.env.EMBER_AI_PROVIDER;
else process.env.EMBER_AI_PROVIDER = previousAIProvider;
if (previousOpenAIKey == null) delete process.env.OPENAI_API_KEY;
else process.env.OPENAI_API_KEY = previousOpenAIKey;
const safeTarget = resolve(testRoot);
const safeTemp = resolve(tmpdir());
if (!safeTarget.startsWith(safeTemp) || !safeTarget.includes('ember-runtime-')) throw new Error('Unsafe runtime test cleanup target');
rmSync(safeTarget, { recursive: true, force: true });

console.log('✓ backend production runtime tests passed');
