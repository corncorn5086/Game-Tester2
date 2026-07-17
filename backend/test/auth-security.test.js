/** Focused tests for unauthenticated auth endpoint abuse controls. */
import assert from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.EMBER_DATA_DIR = mkdtempSync(join(tmpdir(), 'ember-auth-security-db-'));
process.env.EMBER_AUTH_SIGNUP_RATE_LIMIT = '20';
process.env.EMBER_AUTH_LOGIN_RATE_LIMIT = '20';
process.env.EMBER_AUTH_FORGOT_PASSWORD_RATE_LIMIT = '20';
process.env.EMBER_AUTH_RESEND_EMAIL_RATE_LIMIT = '20';
process.env.EMBER_AUTH_OPERATOR_BOOTSTRAP_RATE_LIMIT = '20';
process.env.EMBER_AUTH_RATE_LIMIT_MAX_ENTRIES = '100';

const { createApp } = await import('../src/server.js');
const {
  authRateLimitStats,
  cleanupAuthRateLimitsForTest,
  resetAuthRateLimits
} = await import('../src/auth-security.js');
const {
  authTokenStats,
  cleanupAuthTokens,
  migrateLegacySessionTokens,
  sessionTokenDigest,
  userForToken
} = await import('../src/auth.js');
const { DB_PATH, get, run, now } = await import('../src/db.js');
const { userMirrorPayload } = await import('../src/supabase.js');

const app = createApp();
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;

async function api(method, path, body, extraHeaders = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text, headers: response.headers };
}

function signupBody(suffix) {
  return {
    email: `auth-security-${suffix}@studio.gg`,
    password: 'Hunter2Hunter2',
    name: `Security ${suffix}`,
    username: `security_${suffix}`,
    tosAccepted: true
  };
}

try {
  const primary = await api('POST', '/auth/signup', signupBody('primary'));
  assert.equal(primary.status, 201);

  // The raw bearer token is returned once, while SQLite only retains its
  // prefixed one-way digest.
  const storedSession = get('SELECT token FROM sessions WHERE user_id = ?', [primary.body.user.id]);
  assert.match(storedSession.token, /^sha256:[a-f0-9]{64}$/);
  assert.equal(storedSession.token, sessionTokenDigest(primary.body.token));
  assert.notEqual(storedSession.token, primary.body.token);
  assert.equal(userForToken(primary.body.token)?.id, primary.body.user.id);

  // Verification codes are short-lived, have a durable attempt budget, and
  // are destroyed at exhaustion. Resend rotates rather than accumulating rows.
  const initialVerification = get(
    "SELECT * FROM auth_tokens WHERE user_id = ? AND kind = 'email-verify'",
    [primary.body.user.id]
  );
  assert.ok(initialVerification);
  assert.equal(initialVerification.attempts, 0);
  const initialLifetime = Date.parse(initialVerification.expires_at) - Date.parse(initialVerification.created_at);
  assert.ok(initialLifetime > 0 && initialLifetime <= 10 * 60_000);
  const wrongCode = primary.body.verifyCode === '000000' ? '999999' : '000000';
  for (let attempt = 1; attempt < 5; attempt += 1) {
    const rejected = await api('POST', '/auth/verify-email', { code: wrongCode }, {
      authorization: `Bearer ${primary.body.token}`
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.code, 'EMAIL_VERIFICATION_CODE_INVALID');
    assert.equal(rejected.body.attemptsRemaining, 5 - attempt);
  }
  const exhausted = await api('POST', '/auth/verify-email', { code: wrongCode }, {
    authorization: `Bearer ${primary.body.token}`
  });
  assert.equal(exhausted.status, 429);
  assert.equal(exhausted.body.code, 'EMAIL_VERIFICATION_ATTEMPTS_EXCEEDED');
  assert.equal(get('SELECT token FROM auth_tokens WHERE token = ?', [initialVerification.token]), undefined);

  const firstResend = await api('POST', '/auth/resend-email-code', {}, {
    authorization: `Bearer ${primary.body.token}`
  });
  assert.equal(firstResend.status, 200);
  assert.match(firstResend.body.verifyCode, /^\d{6}$/);
  const firstRotated = get(
    "SELECT * FROM auth_tokens WHERE user_id = ? AND kind = 'email-verify'",
    [primary.body.user.id]
  );
  const secondResend = await api('POST', '/auth/resend-email-code', {}, {
    authorization: `Bearer ${primary.body.token}`
  });
  assert.equal(secondResend.status, 200);
  const secondRotated = get(
    "SELECT * FROM auth_tokens WHERE user_id = ? AND kind = 'email-verify'",
    [primary.body.user.id]
  );
  assert.notEqual(secondRotated.token, firstRotated.token);
  assert.equal(secondRotated.attempts, 0);
  assert.equal(get(
    "SELECT COUNT(*) AS count FROM auth_tokens WHERE user_id = ? AND kind = 'email-verify'",
    [primary.body.user.id]
  ).count, 1);
  const verified = await api('POST', '/auth/verify-email', { code: secondResend.body.verifyCode }, {
    authorization: `Bearer ${primary.body.token}`
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.emailVerified, true);
  assert.equal(get('SELECT email_verified FROM users WHERE id = ?', [primary.body.user.id]).email_verified, 1);
  assert.equal(get(
    "SELECT token FROM auth_tokens WHERE user_id = ? AND kind = 'email-verify'",
    [primary.body.user.id]
  ), undefined);

  // Existing plaintext sessions from pre-hardening builds migrate in place;
  // malformed rows are invalidated instead of becoming permanent credentials.
  const legacyToken = 'ab'.repeat(32);
  run('INSERT INTO sessions (id, token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [
    'legacy-valid', legacyToken, primary.body.user.id, now(), new Date(Date.now() + 60_000).toISOString()
  ]);
  run('INSERT INTO sessions (id, token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [
    'legacy-invalid', 'plaintext-token', primary.body.user.id, now(), new Date(Date.now() + 60_000).toISOString()
  ]);
  assert.deepEqual(migrateLegacySessionTokens(), { migrated: 1, invalidated: 1 });
  assert.equal(get('SELECT token FROM sessions WHERE id = ?', ['legacy-valid']).token, sessionTokenDigest(legacyToken));
  assert.equal(get('SELECT id FROM sessions WHERE id = ?', ['legacy-invalid']), undefined);
  assert.equal(userForToken(legacyToken)?.id, primary.body.user.id);
  assert.equal(readFileSync(DB_PATH).includes(Buffer.from(legacyToken)), false);
  if (existsSync(`${DB_PATH}-wal`)) {
    assert.equal(readFileSync(`${DB_PATH}-wal`).includes(Buffer.from(legacyToken)), false);
  }

  // Cloud user mirrors contain lifecycle state, never the local password
  // verifier that an attacker could crack offline.
  const mirrorPayload = userMirrorPayload({
    ...get('SELECT * FROM users WHERE id = ?', [primary.body.user.id]),
    deleted_at: '2026-07-17T00:00:00.000Z'
  });
  assert.equal(Object.hasOwn(mirrorPayload, 'password_hash'), false);
  assert.equal(mirrorPayload.deleted_at, '2026-07-17T00:00:00.000Z');

  // Async scrypt admission is bounded. Overflow receives a retryable 503
  // instead of blocking the event loop or growing an unbounded promise queue.
  process.env.EMBER_AUTH_SCRYPT_CONCURRENCY = '1';
  process.env.EMBER_AUTH_SCRYPT_QUEUE_LIMIT = '0';
  resetAuthRateLimits();
  const concurrentLogins = await Promise.all(Array.from({ length: 4 }, () => api('POST', '/auth/login', {
    email: 'auth-security-primary@studio.gg', password: 'Hunter2Hunter2'
  })));
  const busyLogins = concurrentLogins.filter((response) => response.status === 503);
  assert.ok(busyLogins.length >= 1);
  assert.ok(concurrentLogins.some((response) => response.status === 200));
  assert.ok(busyLogins.every((response) => response.body.code === 'AUTH_CRYPTO_BUSY'));
  assert.ok(busyLogins.every((response) => response.headers.get('retry-after') === '1'));
  delete process.env.EMBER_AUTH_SCRYPT_CONCURRENCY;
  delete process.env.EMBER_AUTH_SCRYPT_QUEUE_LIMIT;

  // Known and unknown emails have exactly the same public response shape.
  const knownForgot = await api('POST', '/auth/forgot-password', { email: 'auth-security-primary@studio.gg' });
  const unknownForgot = await api('POST', '/auth/forgot-password', { email: 'missing@studio.gg' });
  assert.equal(knownForgot.status, 200);
  assert.deepEqual(knownForgot.body, unknownForgot.body);
  assert.deepEqual(Object.keys(knownForgot.body).sort(), ['message', 'ok']);
  assert.equal(knownForgot.text.includes('resetToken'), false);
  const firstReset = get("SELECT * FROM auth_tokens WHERE kind = 'password-reset' AND user_id = ?", [primary.body.user.id]);
  assert.ok(firstReset?.token);
  assert.ok(Date.parse(firstReset.expires_at) - Date.parse(firstReset.created_at) <= 30 * 60_000);
  run('UPDATE auth_tokens SET created_at = ? WHERE token = ?', [new Date(Date.now() - 120_000).toISOString(), firstReset.token]);
  resetAuthRateLimits();
  assert.equal((await api('POST', '/auth/forgot-password', { email: 'auth-security-primary@studio.gg' })).status, 200);
  const rotatedReset = get("SELECT * FROM auth_tokens WHERE kind = 'password-reset' AND user_id = ?", [primary.body.user.id]);
  assert.notEqual(rotatedReset.token, firstReset.token);
  assert.equal(get(
    "SELECT COUNT(*) AS count FROM auth_tokens WHERE kind = 'password-reset' AND user_id = ?",
    [primary.body.user.id]
  ).count, 1);

  // Forgot-password has its own IP budget and keeps enumeration-neutral success
  // responses below the threshold.
  process.env.EMBER_AUTH_FORGOT_PASSWORD_RATE_LIMIT = '1';
  resetAuthRateLimits();
  assert.equal((await api('POST', '/auth/forgot-password', { email: 'missing-one@studio.gg' })).status, 200);
  const forgotLimited = await api('POST', '/auth/forgot-password', { email: 'missing-two@studio.gg' });
  assert.equal(forgotLimited.status, 429);
  assert.equal(forgotLimited.body.code, 'AUTH_FORGOT_PASSWORD_RATE_LIMITED');
  process.env.EMBER_AUTH_FORGOT_PASSWORD_RATE_LIMIT = '20';
  resetAuthRateLimits();

  // Auth requests cannot inherit the general API's 25 MB body allowance.
  const oversized = await api('POST', '/auth/forgot-password', JSON.stringify({ padding: 'x'.repeat(2_100_000) }));
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.code, 'REQUEST_TOO_LARGE');

  // Signup quota is per effective socket IP; spoofed forwarding headers do not bypass it.
  process.env.EMBER_AUTH_SIGNUP_RATE_LIMIT = '1';
  resetAuthRateLimits();
  const firstSignup = await api('POST', '/auth/signup', signupBody('first'), { 'x-forwarded-for': '198.51.100.10' });
  assert.equal(firstSignup.status, 201);
  const signupLimited = await api('POST', '/auth/signup', signupBody('second'), { 'x-forwarded-for': '203.0.113.20' });
  assert.equal(signupLimited.status, 429);
  assert.equal(signupLimited.body.code, 'AUTH_SIGNUP_RATE_LIMITED');
  assert.ok(Number(signupLimited.headers.get('retry-after')) >= 1);

  // Authenticated email resends have a separate IP budget. A rotated code also
  // expires promptly and cannot be used after cleanup.
  process.env.EMBER_AUTH_RESEND_EMAIL_RATE_LIMIT = '1';
  resetAuthRateLimits();
  const resent = await api('POST', '/auth/resend-email-code', {}, {
    authorization: `Bearer ${firstSignup.body.token}`
  });
  assert.equal(resent.status, 200);
  const resendLimited = await api('POST', '/auth/resend-email-code', {}, {
    authorization: `Bearer ${firstSignup.body.token}`
  });
  assert.equal(resendLimited.status, 429);
  assert.equal(resendLimited.body.code, 'AUTH_RESEND_EMAIL_RATE_LIMITED');
  run(
    "UPDATE auth_tokens SET expires_at = ? WHERE user_id = ? AND kind = 'email-verify'",
    [new Date(Date.now() - 1_000).toISOString(), firstSignup.body.user.id]
  );
  process.env.EMBER_AUTH_RESEND_EMAIL_RATE_LIMIT = '20';
  resetAuthRateLimits();
  const expiredVerification = await api('POST', '/auth/verify-email', { code: resent.body.verifyCode }, {
    authorization: `Bearer ${firstSignup.body.token}`
  });
  assert.equal(expiredVerification.status, 400);
  assert.equal(expiredVerification.body.code, 'EMAIL_VERIFICATION_NOT_PENDING');

  // Failed and successful passwords share the same IP login budget.
  process.env.EMBER_AUTH_LOGIN_RATE_LIMIT = '1';
  resetAuthRateLimits();
  const badLogin = await api('POST', '/auth/login', {
    email: 'auth-security-primary@studio.gg', password: 'wrong-password'
  }, { 'x-forwarded-for': '198.51.100.30' });
  assert.equal(badLogin.status, 401);
  const loginLimited = await api('POST', '/auth/login', {
    email: 'auth-security-primary@studio.gg', password: 'Hunter2Hunter2'
  }, { 'x-forwarded-for': '203.0.113.40' });
  assert.equal(loginLimited.status, 429);
  assert.equal(loginLimited.body.code, 'AUTH_LOGIN_RATE_LIMITED');
  assert.ok(Number(loginLimited.headers.get('retry-after')) >= 1);

  // Expired windows are actively removed from both maps.
  process.env.EMBER_AUTH_SIGNUP_RATE_LIMIT = '20';
  process.env.EMBER_AUTH_LOGIN_RATE_LIMIT = '20';
  resetAuthRateLimits();
  assert.equal((await api('POST', '/auth/signup', signupBody('cleanup'))).status, 201);
  assert.equal((await api('POST', '/auth/login', {
    email: 'auth-security-primary@studio.gg', password: 'wrong-password'
  })).status, 401);
  assert.deepEqual(authRateLimitStats(), {
    signup: 1,
    login: 1,
    forgotPassword: 0,
    resendEmail: 0,
    operatorBootstrap: 0
  });
  cleanupAuthRateLimitsForTest(Date.now() + 11 * 60_000);
  assert.deepEqual(authRateLimitStats(), {
    signup: 0,
    login: 0,
    forgotPassword: 0,
    resendEmail: 0,
    operatorBootstrap: 0
  });

  // Persistent token cleanup removes expired/used rows, while the global row
  // cap fails closed without growing SQLite indefinitely.
  run('DELETE FROM auth_tokens');
  run(
    'INSERT INTO auth_tokens (token, user_id, kind, created_at, expires_at, used) VALUES (?, ?, ?, ?, ?, 0)',
    ['aa'.repeat(24), primary.body.user.id, 'password-reset', now(), new Date(Date.now() - 1_000).toISOString()]
  );
  run(
    'INSERT INTO auth_tokens (token, user_id, kind, created_at, expires_at, used) VALUES (?, ?, ?, ?, ?, 1)',
    ['bb'.repeat(24), primary.body.user.id, 'email-verify', now(), new Date(Date.now() + 60_000).toISOString()]
  );
  assert.equal(cleanupAuthTokens({ checkpoint: false }), 2);
  process.env.EMBER_AUTH_TOKEN_MAX_ROWS = '1';
  process.env.EMBER_AUTH_PASSWORD_RESET_MIN_INTERVAL_MS = '1000';
  resetAuthRateLimits();
  assert.equal((await api('POST', '/auth/forgot-password', { email: 'auth-security-primary@studio.gg' })).status, 200);
  assert.deepEqual(authTokenStats(), { rows: 1, limit: 1 });
  assert.equal((await api('POST', '/auth/forgot-password', { email: 'auth-security-first@studio.gg' })).status, 200);
  assert.deepEqual(authTokenStats(), { rows: 1, limit: 1 });
  delete process.env.EMBER_AUTH_TOKEN_MAX_ROWS;
  delete process.env.EMBER_AUTH_PASSWORD_RESET_MIN_INTERVAL_MS;

  // When trusted-proxy mode is explicitly enabled, distinct forwarded clients
  // are still bounded by the configured map capacity.
  process.env.EMBER_AUTH_RATE_LIMIT_MAX_ENTRIES = '1';
  resetAuthRateLimits();
  app.set('trust proxy', true);
  assert.equal((await api('POST', '/auth/signup', signupBody('proxy1'), { 'x-forwarded-for': '198.51.100.50' })).status, 201);
  const capacityLimited = await api('POST', '/auth/signup', signupBody('proxy2'), { 'x-forwarded-for': '203.0.113.60' });
  assert.equal(capacityLimited.status, 429);
  assert.equal(capacityLimited.body.code, 'AUTH_SIGNUP_RATE_LIMITED');
  assert.ok(authRateLimitStats().signup <= 1);
} finally {
  server.close();
}

console.log('✓ auth security tests passed');
