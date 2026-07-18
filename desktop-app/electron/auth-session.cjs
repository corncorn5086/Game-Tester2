const { mkdir, readFile, rename, unlink, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { DesktopBridgeError } = require('./project-service.cjs');

const SESSION_FILENAME = 'ember-auth-session.v1.json';
const SESSION_VERSION = 1;
const DEFAULT_SERVICE_URL = 'http://localhost:4310';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_SESSION_FILE_BYTES = 64 * 1024;

function createAuthSessionService({
  dataDir,
  safeStorage,
  defaultBaseUrl = DEFAULT_SERVICE_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (typeof dataDir !== 'string' || !dataDir) throw new TypeError('dataDir is required');
  if (!safeStorage || typeof safeStorage.encryptString !== 'function' || typeof safeStorage.decryptString !== 'function') {
    throw new TypeError('safeStorage is required');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');

  const safeDefaultUrl = normalizeServiceUrl(defaultBaseUrl);
  const sessionPath = join(dataDir, SESSION_FILENAME);

  function serviceUrl(baseUrl) {
    return normalizeServiceUrl(baseUrl || safeDefaultUrl);
  }

  async function login(input, { baseUrl } = {}) {
    const url = serviceUrl(baseUrl);
    const credentials = loginPayload(input);
    const payload = await authRequest(fetchImpl, url, '/auth/login', {
      method: 'POST',
      body: credentials,
      timeoutMs
    });
    return acceptAuthenticatedResponse(payload, url);
  }

  async function signup(input, { baseUrl } = {}) {
    const url = serviceUrl(baseUrl);
    const registration = signupPayload(input);
    const payload = await authRequest(fetchImpl, url, '/auth/signup', {
      method: 'POST',
      body: registration,
      timeoutMs
    });
    return acceptAuthenticatedResponse(payload, url);
  }

  async function updateProfile(input, { baseUrl } = {}) {
    const url = serviceUrl(baseUrl);
    const profile = profilePayload(input);
    const token = await requireAuthenticatedToken(url);
    const payload = await authRequest(fetchImpl, url, '/auth/me', {
      method: 'PATCH',
      body: profile,
      token,
      timeoutMs
    });
    const user = cleanUser(payload?.user);
    if (!user) {
      throw new DesktopBridgeError('AUTH_RESPONSE_INVALID', 'Le service Ember a retourné un profil invalide.');
    }
    return { authenticated: true, user };
  }

  async function changePassword(input, { baseUrl } = {}) {
    const url = serviceUrl(baseUrl);
    const passwords = passwordChangePayload(input);
    const token = await requireAuthenticatedToken(url);
    const payload = await authRequest(fetchImpl, url, '/auth/change-password', {
      method: 'POST',
      body: passwords,
      token,
      timeoutMs
    });
    if (payload?.ok !== true) {
      throw new DesktopBridgeError('AUTH_RESPONSE_INVALID', 'Le service Ember n’a pas confirmé le changement de mot de passe.');
    }
    return { changed: true };
  }

  async function requireAuthenticatedToken(url) {
    const session = await readBoundSession(url);
    if (!session.token) {
      throw new DesktopBridgeError(
        'AUTH_REQUIRED',
        'Connectez-vous à votre compte Ember pour modifier ces réglages.',
        { reason: session.reason || 'signed-out' }
      );
    }
    return session.token;
  }

  async function acceptAuthenticatedResponse(payload, url) {
    const token = validOpaqueToken(payload?.token);
    const user = cleanUser(payload?.user);
    if (!token || !user) {
      throw new DesktopBridgeError('AUTH_RESPONSE_INVALID', 'Le service Ember a retourné une session invalide.');
    }
    try {
      await saveSession(url, token);
    } catch (error) {
      // Avoid leaving an orphaned server session when OS encryption or the
      // atomic local write fails after a successful login/signup.
      await rawRequest(fetchImpl, url, '/auth/logout', {
        method: 'POST',
        token,
        timeoutMs
      }).catch(() => {});
      throw error;
    }
    return {
      authenticated: true,
      user,
      workspace: cleanWorkspace(payload?.workspace)
    };
  }

  async function getStatus({ baseUrl } = {}) {
    const url = serviceUrl(baseUrl);
    const session = await readBoundSession(url);
    if (!session.token) return signedOutStatus(session.reason);
    let response;
    try {
      response = await rawRequest(fetchImpl, url, '/auth/me', {
        method: 'GET',
        token: session.token,
        timeoutMs
      });
    } catch {
      return {
        authenticated: false,
        user: null,
        workspace: null,
        offline: true,
        reason: 'service-unreachable'
      };
    }

    const payload = await responsePayload(response);
    if (response.status === 401 || response.status === 403) {
      await deleteSession();
      return signedOutStatus('session-expired');
    }
    if (!response.ok) {
      return {
        authenticated: false,
        user: null,
        workspace: null,
        offline: true,
        reason: 'service-unavailable'
      };
    }
    const user = cleanUser(payload?.user);
    if (!user) {
      return {
        authenticated: false,
        user: null,
        workspace: null,
        offline: true,
        reason: 'invalid-service-response'
      };
    }
    return {
      authenticated: true,
      user,
      workspace: cleanWorkspace(payload?.workspace),
      offline: false
    };
  }

  async function logout({ baseUrl } = {}) {
    const url = serviceUrl(baseUrl);
    const session = await readBoundSession(url);
    // Local logout is authoritative. Clear the encrypted session before the
    // network request so an offline backend can never trap a user signed in.
    await deleteSession();
    if (session.token) {
      try {
        await rawRequest(fetchImpl, url, '/auth/logout', {
          method: 'POST',
          token: session.token,
          timeoutMs
        });
      } catch {
        // Remote revocation is best effort; the local token is already gone.
      }
    }
    return { authenticated: false };
  }

  /** Main-process-only. Never expose this method through preload. */
  async function getSessionToken({ baseUrl } = {}) {
    const session = await readBoundSession(serviceUrl(baseUrl));
    return session.token;
  }

  async function saveSession(url, token) {
    assertEncryptionAvailable(safeStorage);
    let encrypted;
    try {
      encrypted = safeStorage.encryptString(token);
    } catch {
      throw new DesktopBridgeError('AUTH_SECURE_STORAGE_FAILED', 'Ember n’a pas pu chiffrer la session du compte.');
    }
    if (!Buffer.isBuffer(encrypted) || encrypted.length === 0 || encrypted.length > 32 * 1024) {
      throw new DesktopBridgeError('AUTH_SECURE_STORAGE_FAILED', 'Ember n’a pas pu chiffrer la session du compte.');
    }
    const document = `${JSON.stringify({
      version: SESSION_VERSION,
      serviceUrl: url,
      encryptedToken: encrypted.toString('base64')
    }, null, 2)}\n`;
    await mkdir(dataDir, { recursive: true });
    const temporary = `${sessionPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, document, { encoding: 'utf8', mode: 0o600 });
      try {
        await rename(temporary, sessionPath);
      } catch (error) {
        if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error;
        await unlink(sessionPath).catch((unlinkError) => {
          if (unlinkError?.code !== 'ENOENT') throw unlinkError;
        });
        await rename(temporary, sessionPath);
      }
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw new DesktopBridgeError('AUTH_SESSION_WRITE_FAILED', 'Ember n’a pas pu enregistrer la session chiffrée.', null, error);
    }
  }

  async function readBoundSession(expectedUrl) {
    let text;
    try {
      text = await readFile(sessionPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return { token: null, reason: 'signed-out' };
      return { token: null, reason: 'session-unreadable' };
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_SESSION_FILE_BYTES) {
      await deleteSession().catch(() => {});
      return { token: null, reason: 'session-invalid' };
    }

    let parsed;
    try { parsed = JSON.parse(text); }
    catch {
      await deleteSession().catch(() => {});
      return { token: null, reason: 'session-invalid' };
    }
    if (
      parsed?.version !== SESSION_VERSION
      || typeof parsed.serviceUrl !== 'string'
      || typeof parsed.encryptedToken !== 'string'
      || parsed.encryptedToken.length < 4
      || parsed.encryptedToken.length > 48 * 1024
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(parsed.encryptedToken)
    ) {
      await deleteSession().catch(() => {});
      return { token: null, reason: 'session-invalid' };
    }

    let storedUrl;
    try { storedUrl = normalizeServiceUrl(parsed.serviceUrl); }
    catch {
      await deleteSession().catch(() => {});
      return { token: null, reason: 'session-invalid' };
    }
    if (storedUrl !== expectedUrl) return { token: null, reason: 'service-mismatch' };
    if (!encryptionAvailable(safeStorage)) return { token: null, reason: 'secure-storage-unavailable' };

    let token;
    try {
      token = safeStorage.decryptString(Buffer.from(parsed.encryptedToken, 'base64'));
    } catch {
      await deleteSession().catch(() => {});
      return { token: null, reason: 'session-invalid' };
    }
    token = validOpaqueToken(token);
    if (!token) {
      await deleteSession().catch(() => {});
      return { token: null, reason: 'session-invalid' };
    }
    return { token, reason: null };
  }

  async function deleteSession() {
    try { await unlink(sessionPath); }
    catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new DesktopBridgeError('AUTH_SESSION_DELETE_FAILED', 'Ember n’a pas pu supprimer la session locale chiffrée.');
      }
    }
  }

  return { changePassword, getSessionToken, getStatus, login, logout, signup, updateProfile };
}

async function authRequest(fetchImpl, baseUrl, path, options) {
  let response;
  try { response = await rawRequest(fetchImpl, baseUrl, path, options); }
  catch (error) {
    if (error instanceof DesktopBridgeError) throw error;
    throw new DesktopBridgeError('AUTH_SERVICE_UNREACHABLE', 'Le service de compte Ember est injoignable.', null, error);
  }
  const payload = await responsePayload(response);
  if (!response.ok) throw authHttpError(response.status, payload);
  return payload;
}

async function rawRequest(fetchImpl, baseUrl, path, { method, body, token, timeoutMs }) {
  const headers = { accept: 'application/json' };
  let serialized;
  if (body !== undefined) {
    serialized = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  if (token) headers.authorization = `Bearer ${token}`;
  return fetchImpl(`${baseUrl}${path}`, {
    method,
    headers,
    body: serialized,
    redirect: 'error',
    signal: AbortSignal.timeout(Math.max(1_000, timeoutMs || DEFAULT_TIMEOUT_MS))
  });
}

async function responsePayload(response) {
  try { return await response?.json?.(); }
  catch { return null; }
}

function authHttpError(status, payload) {
  const message = cleanText(payload?.error, 500);
  const field = cleanField(payload?.field);
  if (status === 400) return new DesktopBridgeError('AUTH_REQUEST_INVALID', message || 'Les informations du compte sont invalides.', { status, field });
  if ((status === 401 || status === 403) && field === 'currentPassword') {
    return new DesktopBridgeError('AUTH_CURRENT_PASSWORD_INVALID', message || 'Le mot de passe actuel est incorrect.', { status, field });
  }
  if (status === 401 || status === 403) return new DesktopBridgeError('AUTH_INVALID_CREDENTIALS', 'Le courriel ou le mot de passe est invalide.', { status });
  if (status === 409) return new DesktopBridgeError('AUTH_ACCOUNT_CONFLICT', message || 'Ce compte existe déjà.', { status, field });
  if (status === 429) return new DesktopBridgeError('AUTH_RATE_LIMITED', 'Trop de tentatives. Réessayez dans un moment.', { status });
  return new DesktopBridgeError('AUTH_SERVICE_ERROR', 'Le service de compte Ember n’a pas pu terminer la demande.', { status });
}

function loginPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidInput();
  return {
    email: requiredText(input.email, 320),
    password: requiredText(input.password, 1_024)
  };
}

function signupPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidInput();
  return {
    name: optionalText(input.name, 200),
    email: requiredText(input.email, 320),
    password: requiredText(input.password, 1_024),
    tosAccepted: input.tosAccepted === true,
    language: optionalText(input.language, 20) || 'en'
  };
}

function profilePayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidInput();
  const name = requiredText(input.name, 200).trim();
  if (!name) throw invalidInput();
  return { name };
}

function passwordChangePayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidInput();
  return {
    currentPassword: requiredText(input.currentPassword, 1_024),
    newPassword: requiredText(input.newPassword, 1_024)
  };
}

function invalidInput() {
  return new DesktopBridgeError('AUTH_INPUT_INVALID', 'Les informations du compte sont invalides.');
}

function requiredText(value, max) {
  if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw invalidInput();
  return value;
}

function optionalText(value, max) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw invalidInput();
  return value;
}

function validOpaqueToken(value) {
  return typeof value === 'string'
    && value.length >= 20
    && value.length <= 4_096
    && /^[A-Za-z0-9._~-]+$/.test(value)
    ? value
    : null;
}

function cleanUser(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = cleanIdentifier(value.id, 160);
  const email = cleanText(value.email, 320);
  if (!id || !email) return null;
  const user = {
    id,
    email,
    name: cleanText(value.name, 200),
    username: cleanText(value.username, 80),
    dob: cleanText(value.dob, 40),
    phone: cleanText(value.phone, 80),
    address: cleanText(value.address, 500),
    role: cleanText(value.role, 160),
    userType: cleanText(value.userType, 160),
    company: cleanText(value.company, 200),
    goal: cleanText(value.goal, 500),
    language: cleanText(value.language, 20) || 'en',
    country: cleanText(value.country, 100),
    avatarColor: /^#[0-9a-f]{6}$/i.test(value.avatarColor || '') ? value.avatarColor : null,
    avatarData: typeof value.avatarData === 'string'
      && value.avatarData.length <= 1_500_000
      && /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(value.avatarData)
      ? value.avatarData
      : null,
    emailVerified: value.emailVerified === true,
    phoneVerified: value.phoneVerified === true,
    tosAccepted: value.tosAccepted === true,
    createdAt: cleanText(value.createdAt, 80)
  };
  return user;
}

function cleanWorkspace(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = cleanIdentifier(value.id, 160);
  if (!id) return null;
  return { id, name: cleanText(value.name, 200) };
}

function signedOutStatus(reason) {
  return { authenticated: false, user: null, workspace: null, offline: false, reason: reason || 'signed-out' };
}

function cleanIdentifier(value, max) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{2,160}$/.test(value) ? value.slice(0, max) : null;
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) || null : null;
}

function cleanField(value) {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(value) ? value : null;
}

function encryptionAvailable(safeStorage) {
  try {
    if (safeStorage.isEncryptionAvailable() !== true) return false;
    // Electron's Linux `basic_text` fallback is reversible obfuscation, not an
    // acceptable secure store for an Ember account session.
    if (typeof safeStorage.getSelectedStorageBackend === 'function'
      && safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
    return true;
  }
  catch { return false; }
}

function assertEncryptionAvailable(safeStorage) {
  if (!encryptionAvailable(safeStorage)) {
    throw new DesktopBridgeError(
      'AUTH_SECURE_STORAGE_UNAVAILABLE',
      'Le stockage sécurisé du système n’est pas disponible. La session ne sera pas enregistrée en clair.'
    );
  }
}

function normalizeServiceUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || DEFAULT_SERVICE_URL)); }
  catch { throw new DesktopBridgeError('AUTH_SERVICE_URL_INVALID', 'L’adresse du service Ember est invalide.'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new DesktopBridgeError('AUTH_SERVICE_URL_INVALID', 'L’adresse du service Ember doit être une URL HTTP(S) sans identifiants intégrés.');
  }
  if (parsed.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)) {
    throw new DesktopBridgeError('AUTH_SERVICE_URL_INSECURE', 'Le service Ember distant doit utiliser HTTPS.');
  }
  return parsed.toString().replace(/\/$/, '');
}

module.exports = {
  SESSION_FILENAME,
  createAuthSessionService,
  normalizeServiceUrl
};
