const assert = require('node:assert');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { SESSION_FILENAME, createAuthSessionService } = require('./auth-session.cjs');

const jsonResponse = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload
});

function fakeSafeStorage(available = true) {
  const key = Buffer.from('ember-test-key');
  const transform = (buffer) => Buffer.from(buffer.map((byte, index) => byte ^ key[index % key.length]));
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => transform(Buffer.from(value, 'utf8')),
    decryptString: (value) => transform(value).toString('utf8')
  };
}

function publicUser(id, email) {
  return {
    id,
    email,
    name: 'Ember User',
    username: 'ember.user',
    language: 'fr',
    avatarColor: '#ff4d00',
    emailVerified: true,
    phoneVerified: false,
    tosAccepted: true,
    createdAt: '2026-07-16T12:00:00.000Z',
    passwordHash: 'must-not-pass-through'
  };
}

async function main() {
  const dataDir = mkdtempSync(join(tmpdir(), 'ember-auth-session-'));
  const firstToken = 'a'.repeat(64);
  const secondToken = 'b'.repeat(64);
  const password = 'StrongPass88';
  const calls = [];
  let logoutOffline = false;
  let meUnauthorized = false;

  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, {
        token: firstToken,
        user: publicUser('usr_login', 'person@example.com'),
        workspace: { id: 'ws_login', name: 'Login Workspace' }
      });
    }
    if (url.endsWith('/auth/signup')) {
      return jsonResponse(201, {
        token: secondToken,
        verifyCode: '123456',
        user: publicUser('usr_signup', 'new@example.com'),
        workspace: { id: 'ws_signup', name: 'Signup Workspace' }
      });
    }
    if (url.endsWith('/auth/me')) {
      if (meUnauthorized) return jsonResponse(401, { error: 'Authentication required' });
      return jsonResponse(200, {
        user: publicUser('usr_login', 'person@example.com'),
        workspace: { id: 'ws_login', name: 'Login Workspace' },
        settings: { privateNestedValue: 'not-needed-by-desktop-auth' }
      });
    }
    if (url.endsWith('/auth/logout')) {
      if (logoutOffline) throw new Error('network unavailable');
      return jsonResponse(200, { ok: true });
    }
    return jsonResponse(404, { error: 'not found' });
  };

  try {
    const service = createAuthSessionService({
      dataDir,
      safeStorage: fakeSafeStorage(),
      defaultBaseUrl: 'https://api.ember.example',
      fetchImpl
    });

    const login = await service.login({
      email: 'person@example.com',
      password,
      apiKey: 'provider-key-must-never-be-sent'
    });
    assert.equal(login.authenticated, true);
    assert.equal(login.user.email, 'person@example.com');
    assert.equal('token' in login, false);
    assert.equal(JSON.stringify(login).includes(firstToken), false);
    assert.equal(JSON.stringify(login).includes('passwordHash'), false, 'server-only user fields are allow-listed out');

    const loginCall = calls.find((call) => call.url.endsWith('/auth/login'));
    assert.deepEqual(JSON.parse(loginCall.options.body), { email: 'person@example.com', password });
    assert.equal(loginCall.options.headers.authorization, undefined);
    assert.equal(loginCall.options.redirect, 'error');
    assert.equal(loginCall.options.body.includes('provider-key-must-never-be-sent'), false);

    const sessionPath = join(dataDir, SESSION_FILENAME);
    assert.equal(existsSync(sessionPath), true);
    const stored = readFileSync(sessionPath, 'utf8');
    assert.equal(stored.includes(firstToken), false, 'opaque token is never stored in plaintext');
    assert.equal(stored.includes(password), false, 'password is never persisted');
    assert.equal(JSON.parse(stored).serviceUrl, 'https://api.ember.example');

    const status = await service.getStatus();
    assert.deepEqual(status, {
      authenticated: true,
      user: login.user,
      workspace: { id: 'ws_login', name: 'Login Workspace' },
      offline: false
    });
    const meCall = calls.find((call) => call.url.endsWith('/auth/me'));
    assert.equal(meCall.options.headers.authorization, `Bearer ${firstToken}`);
    assert.equal(meCall.options.body, undefined);

    const beforeMismatchCalls = calls.length;
    const mismatch = await service.getStatus({ baseUrl: 'https://other.ember.example' });
    assert.equal(mismatch.authenticated, false);
    assert.equal(mismatch.reason, 'service-mismatch');
    assert.equal(calls.length, beforeMismatchCalls, 'bound token is never sent to another service origin');
    assert.equal(await service.getSessionToken({ baseUrl: 'https://other.ember.example' }), null);
    assert.equal(await service.getSessionToken(), firstToken, 'main-process accessor can recover the bound token');

    logoutOffline = true;
    assert.deepEqual(await service.logout(), { authenticated: false });
    assert.equal(existsSync(sessionPath), false, 'local logout succeeds even when remote revocation is offline');
    logoutOffline = false;

    const signup = await service.signup({
      name: 'New User',
      email: 'new@example.com',
      password: 'SignupPass9',
      tosAccepted: true,
      language: 'fr',
      apiKey: 'provider-key-must-not-be-forwarded',
      credentials: { provider: 'openai' }
    });
    assert.equal(signup.authenticated, true);
    assert.equal('token' in signup, false);
    assert.equal('verifyCode' in signup, false);
    assert.equal(JSON.stringify(signup).includes(secondToken), false);
    const signupCall = calls.find((call) => call.url.endsWith('/auth/signup'));
    assert.deepEqual(JSON.parse(signupCall.options.body), {
      name: 'New User',
      email: 'new@example.com',
      password: 'SignupPass9',
      tosAccepted: true,
      language: 'fr'
    });
    assert.equal(signupCall.options.body.includes('provider-key'), false);

    meUnauthorized = true;
    const expired = await service.getStatus();
    assert.equal(expired.authenticated, false);
    assert.equal(expired.reason, 'session-expired');
    assert.equal(existsSync(sessionPath), false, '401 validation deletes the expired local session');

    const unavailableDir = join(dataDir, 'unavailable');
    const unavailable = createAuthSessionService({
      dataDir: unavailableDir,
      safeStorage: fakeSafeStorage(false),
      defaultBaseUrl: 'https://api.ember.example',
      fetchImpl
    });
    await assert.rejects(
      unavailable.login({ email: 'person@example.com', password }),
      (error) => error.code === 'AUTH_SECURE_STORAGE_UNAVAILABLE'
    );
    assert.equal(existsSync(join(unavailableDir, SESSION_FILENAME)), false, 'no plaintext fallback is created');

    const basicTextStorage = fakeSafeStorage(true);
    basicTextStorage.getSelectedStorageBackend = () => 'basic_text';
    const insecureLinuxFallback = createAuthSessionService({
      dataDir: join(dataDir, 'basic-text'),
      safeStorage: basicTextStorage,
      defaultBaseUrl: 'https://api.ember.example',
      fetchImpl
    });
    await assert.rejects(
      insecureLinuxFallback.login({ email: 'person@example.com', password }),
      (error) => error.code === 'AUTH_SECURE_STORAGE_UNAVAILABLE'
    );

    assert.throws(
      () => createAuthSessionService({
        dataDir,
        safeStorage: fakeSafeStorage(),
        defaultBaseUrl: 'http://remote.example',
        fetchImpl
      }),
      (error) => error.code === 'AUTH_SERVICE_URL_INSECURE'
    );
    assert.doesNotThrow(() => createAuthSessionService({
      dataDir,
      safeStorage: fakeSafeStorage(),
      defaultBaseUrl: 'http://[::1]:4310',
      fetchImpl
    }));

    const badCredentials = createAuthSessionService({
      dataDir: join(dataDir, 'bad-login'),
      safeStorage: fakeSafeStorage(),
      defaultBaseUrl: 'https://api.ember.example',
      fetchImpl: async () => jsonResponse(401, { error: 'Invalid email or password' })
    });
    await assert.rejects(
      badCredentials.login({ email: 'person@example.com', password: 'WrongPass9' }),
      (error) => error.code === 'AUTH_INVALID_CREDENTIALS'
        && !error.message.includes('WrongPass9')
        && !error.message.includes(firstToken)
    );

    console.log('✓ desktop encrypted auth session tests passed');
  } finally {
    const target = resolve(dataDir);
    const safeRoot = resolve(tmpdir());
    if (!target.startsWith(safeRoot) || !target.includes('ember-auth-session-')) throw new Error('Unsafe test cleanup target');
    rmSync(target, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
