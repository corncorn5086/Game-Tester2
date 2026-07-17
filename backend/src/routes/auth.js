import { Router } from 'express';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { makeId } from '@ember/shared/constants';
import { db, get, all, run, now, j } from '../db.js';
import {
  AuthTokenCapacityError,
  cleanupAuthTokens,
  createSession,
  destroySession,
  ensureAuthTokenCapacity,
  ensureDefaultWorkspace,
  hashPassword,
  publicUser,
  requireAuth,
  rotateAuthToken,
  sessionTokenDigest,
  verifyPassword,
  pickAvatarColor
} from '../auth.js';
import { mirrorUser } from '../supabase.js';

export const authRouter = Router();

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_EMAIL_VERIFY_TTL_MS = 10 * 60_000;
const DEFAULT_EMAIL_VERIFY_MAX_ATTEMPTS = 5;
const DEFAULT_PASSWORD_RESET_TTL_MS = 30 * 60_000;
const DEFAULT_PASSWORD_RESET_MIN_INTERVAL_MS = 60_000;
const DEFAULT_PHONE_VERIFY_TTL_MS = 10 * 60_000;
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch((error) => {
  if (error?.code === 'AUTH_CRYPTO_BUSY') {
    res.setHeader('Retry-After', '1');
    return res.status(503).json({
      error: 'Authentication is busy. Please retry shortly.',
      code: 'AUTH_CRYPTO_BUSY'
    });
  }
  if (error instanceof AuthTokenCapacityError || error?.code === 'AUTH_TOKEN_CAPACITY_REACHED') {
    res.setHeader('Retry-After', '60');
    return res.status(503).json({
      error: 'Authentication token capacity is temporarily full. Try again later.',
      code: 'AUTH_TOKEN_CAPACITY_REACHED'
    });
  }
  return next(error);
});

function boundedInteger(name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(process.env[name] ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function emailVerifyTtlMs() {
  return boundedInteger('EMBER_AUTH_EMAIL_VERIFY_TTL_MS', DEFAULT_EMAIL_VERIFY_TTL_MS, 60_000, 30 * 60_000);
}

function emailVerifyMaxAttempts() {
  return boundedInteger('EMBER_AUTH_EMAIL_VERIFY_MAX_ATTEMPTS', DEFAULT_EMAIL_VERIFY_MAX_ATTEMPTS, 1, 10);
}

function passwordResetTtlMs() {
  return boundedInteger('EMBER_AUTH_PASSWORD_RESET_TTL_MS', DEFAULT_PASSWORD_RESET_TTL_MS, 5 * 60_000, 24 * 60 * 60_000);
}

function passwordResetMinIntervalMs() {
  return boundedInteger(
    'EMBER_AUTH_PASSWORD_RESET_MIN_INTERVAL_MS',
    DEFAULT_PASSWORD_RESET_MIN_INTERVAL_MS,
    1_000,
    60 * 60_000
  );
}

function secureSixDigitCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function digest(value, domain) {
  return createHash('sha256').update(`${domain}\0${String(value ?? '')}`, 'utf8').digest();
}

function constantTimeMatch(actual, expected, domain) {
  return timingSafeEqual(digest(actual, domain), digest(expected, domain));
}

function normalizedEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email.length <= 320 && EMAIL_RE.test(email) ? email : null;
}

function operatorBootstrapConfig() {
  const email = normalizedEmail(process.env.EMBER_OPERATOR_BOOTSTRAP_EMAIL);
  const secret = String(process.env.EMBER_OPERATOR_BOOTSTRAP_SECRET ?? '');
  if (!email || Buffer.byteLength(secret, 'utf8') < 32 || Buffer.byteLength(secret, 'utf8') > 1_024) return null;
  return { email, secret };
}

function issueEmailVerification(userId) {
  const code = secureSixDigitCode();
  rotateAuthToken({ userId, kind: 'email-verify', code, ttlMs: emailVerifyTtlMs() });
  return code;
}

function isProductionRequest(req) {
  const configured = req.app?.locals?.runtimeConfig?.production;
  return typeof configured === 'boolean'
    ? configured
    : String(process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
}

function publicSignupEnabled(req) {
  const configured = req.app?.locals?.runtimeConfig?.publicSignup;
  if (typeof configured === 'boolean') return configured;
  return !isProductionRequest(req)
    || String(process.env.EMBER_PUBLIC_SIGNUP ?? '').trim().toLowerCase() === 'true';
}

function developmentVerificationValue(req, field, value) {
  return isProductionRequest(req) ? {} : { [field]: value };
}

function validatePassword(pw) {
  if (String(pw).length < 8) return 'Password must be at least 8 characters';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) {
    return 'Password must include an uppercase letter, a lowercase letter and a number';
  }
  return null;
}

/**
 * One-time production bootstrap. This is intentionally not the normal signup
 * route: the operator proves possession of a high-entropy server secret and
 * the exact configured email address. The durable singleton makes the proof
 * non-replayable even if the account is later deactivated or the process is
 * restarted. This secret belongs only in the hosting environment and the
 * operator's one-time HTTPS request, never in Desktop or a packaged renderer.
 */
authRouter.post('/auth/bootstrap-operator', asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const configured = operatorBootstrapConfig();
  if (!configured) {
    return res.status(503).json({
      error: 'Operator bootstrap is not configured.',
      code: 'OPERATOR_BOOTSTRAP_UNAVAILABLE'
    });
  }

  const body = req.body ?? {};
  const secretHeader = req.get('x-ember-bootstrap-secret');
  const submittedSecret = typeof secretHeader === 'string' && Buffer.byteLength(secretHeader, 'utf8') <= 1_024
    ? secretHeader
    : '';
  const submittedEmail = normalizedEmail(body.email);
  const validProof = submittedEmail === configured.email
    && constantTimeMatch(submittedSecret, configured.secret, 'ember-operator-bootstrap-v1');
  if (!validProof) {
    return res.status(403).json({
      error: 'Operator bootstrap proof is invalid.',
      code: 'OPERATOR_BOOTSTRAP_PROOF_INVALID'
    });
  }

  if (get('SELECT singleton FROM operator_bootstrap WHERE singleton = 1')
      || get('SELECT id FROM users WHERE deleted_at IS NULL LIMIT 1')) {
    return res.status(409).json({
      error: 'Operator bootstrap is already closed.',
      code: 'OPERATOR_BOOTSTRAP_CLOSED'
    });
  }

  const passwordError = validatePassword(body.password ?? '');
  if (passwordError) return res.status(400).json({ error: passwordError, field: 'password' });
  if (body.username && !USERNAME_RE.test(String(body.username))) {
    return res.status(400).json({ error: 'Username must be 3–32 chars (letters, numbers, _ or .)', field: 'username' });
  }
  if (!body.tosAccepted) {
    return res.status(400).json({ error: 'You must accept the Terms and Privacy Policy', field: 'tosAccepted' });
  }

  const passwordHash = await hashPassword(String(body.password));
  const userId = makeId('usr');
  const createdAt = now();
  let transactionStarted = false;
  let workspace;
  try {
    db.exec('BEGIN IMMEDIATE');
    transactionStarted = true;
    if (get('SELECT singleton FROM operator_bootstrap WHERE singleton = 1')
        || get('SELECT id FROM users WHERE deleted_at IS NULL LIMIT 1')
        || get('SELECT id FROM users WHERE email = ?', [configured.email])) {
      const closed = new Error('Operator bootstrap is already closed.');
      closed.code = 'OPERATOR_BOOTSTRAP_CLOSED';
      throw closed;
    }

    run(
      `INSERT INTO users (
         id, email, name, username, password_hash, role, user_type, company,
         goal, language, country, tos_accepted, email_verified, avatar_color,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`,
      [
        userId,
        configured.email,
        body.name ?? null,
        body.username ?? null,
        passwordHash,
        body.role ?? null,
        body.userType ?? null,
        body.company ?? null,
        body.goal ?? null,
        body.language ?? 'en',
        body.country ?? null,
        pickAvatarColor(configured.email),
        createdAt,
        createdAt
      ]
    );
    workspace = ensureDefaultWorkspace(
      userId,
      body.company ? `${body.company} Workspace` : body.name ? `${body.name}'s Workspace` : 'My Workspace'
    );
    run(
      'INSERT INTO operator_bootstrap (singleton, user_id, claimed_at) VALUES (1, ?, ?)',
      [userId, createdAt]
    );
    db.exec('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      try { db.exec('ROLLBACK'); } catch { /* preserve the original bootstrap failure */ }
    }
    if (error?.code === 'OPERATOR_BOOTSTRAP_CLOSED') {
      return res.status(409).json({ error: error.message, code: error.code });
    }
    throw error;
  }

  const user = get('SELECT * FROM users WHERE id = ?', [userId]);
  mirrorUser(user);
  return res.status(201).json({
    bootstrapComplete: true,
    user: publicUser(user),
    workspace: { id: workspace.id, name: workspace.name }
  });
}));

authRouter.post('/auth/signup', asyncRoute(async (req, res) => {
  if (!publicSignupEnabled(req)) {
    return res.status(403).json({
      error: 'Public account creation is disabled.',
      code: 'PUBLIC_SIGNUP_DISABLED'
    });
  }
  const {
    email, password, name, username,
    dob, phone, address, role, userType, company, goal, tosAccepted,
    language, country
  } = req.body ?? {};

  const normEmail = normalizedEmail(email);
  if (!normEmail) return res.status(400).json({ error: 'A valid email is required', field: 'email' });
  const pwErr = validatePassword(password ?? '');
  if (pwErr) return res.status(400).json({ error: pwErr, field: 'password' });
  if (username && !USERNAME_RE.test(String(username))) return res.status(400).json({ error: 'Username must be 3–32 chars (letters, numbers, _ or .)', field: 'username' });
  if (!tosAccepted) return res.status(400).json({ error: 'You must accept the Terms and Privacy Policy', field: 'tosAccepted' });

  if (get('SELECT id FROM users WHERE email = ?', [normEmail])) return res.status(409).json({ error: 'An account with this email already exists', field: 'email' });
  if (username && get('SELECT id FROM users WHERE username = ?', [username])) return res.status(409).json({ error: 'This username is taken', field: 'username' });

  const id = makeId('usr');
  const avatarColor = pickAvatarColor(normEmail);
  const passwordHash = await hashPassword(String(password));
  // Password derivation yields to the event loop, so repeat uniqueness checks
  // before the synchronous insert to preserve deterministic 409 responses.
  if (get('SELECT id FROM users WHERE email = ?', [normEmail])) return res.status(409).json({ error: 'An account with this email already exists', field: 'email' });
  if (username && get('SELECT id FROM users WHERE username = ?', [username])) return res.status(409).json({ error: 'This username is taken', field: 'username' });
  ensureAuthTokenCapacity();
  run(
    `INSERT INTO users (id, email, name, username, password_hash, dob, phone, address, role, user_type, company, goal, language, country, tos_accepted, avatar_color, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, normEmail, name ?? null, username ?? null, passwordHash,
      dob ?? null, phone ?? null, address ?? null, role ?? null, userType ?? null, company ?? null, goal ?? null,
      language ?? 'en', country ?? null, 1, avatarColor, now(), now()
    ]
  );
  const workspace = ensureDefaultWorkspace(id, company ? `${company} Workspace` : name ? `${name}'s Workspace` : 'My Workspace');
  const token = createSession(id);
  const user = get('SELECT * FROM users WHERE id = ?', [id]);
  mirrorUser(user);

  // Issue an email verification code. Only local development may echo it;
  // production must deliver it through a trusted transport.
  const code = issueEmailVerification(id);

  res.status(201).json({
    token,
    user: publicUser(user),
    workspace: { id: workspace.id, name: workspace.name },
    ...developmentVerificationValue(req, 'verifyCode', code)
  });
}));

authRouter.post('/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body ?? {};
  const normalized = String(email ?? '').toLowerCase();
  const user = get('SELECT * FROM users WHERE email = ?', [normalized]);

  if (!user || user.deleted_at || !(await verifyPassword(String(password ?? ''), user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = createSession(user.id);
  res.json({ token, user: publicUser(user), workspace: workspaceFor(user.id) });
}));

function workspaceFor(userId) {
  const ws = ensureDefaultWorkspace(userId);
  return { id: ws.id, name: ws.name };
}

authRouter.post('/auth/logout', requireAuth, (req, res) => {
  destroySession(req.token);
  res.json({ ok: true });
});

authRouter.get('/auth/me', requireAuth, (req, res) => {
  const workspace = ensureDefaultWorkspace(req.user.id);
  res.json({ user: publicUser(req.user), workspace: { id: workspace.id, name: workspace.name }, settings: j(req.user.settings_json, {}) });
});

// Update profile fields (name, username, personal info, professional info).
const PROFILE_FIELDS = { name: 'name', username: 'username', dob: 'dob', phone: 'phone', address: 'address', role: 'role', userType: 'user_type', company: 'company', goal: 'goal', language: 'language', country: 'country' };
authRouter.patch('/auth/me', requireAuth, (req, res) => {
  const body = req.body ?? {};
  const updates = [];
  const params = [];

  if (body.username !== undefined && body.username !== req.user.username) {
    if (body.username && !USERNAME_RE.test(String(body.username))) return res.status(400).json({ error: 'Invalid username', field: 'username' });
    if (body.username && get('SELECT id FROM users WHERE username = ? AND id != ?', [body.username, req.user.id])) {
      return res.status(409).json({ error: 'This username is taken', field: 'username' });
    }
  }
  if (body.avatar !== undefined) {
    const avatar = body.avatar;
    if (avatar !== null && (typeof avatar !== 'string' || !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(avatar))) {
      return res.status(400).json({ error: 'Avatar must be a PNG/JPEG/WEBP/GIF image', field: 'avatar' });
    }
    if (avatar && avatar.length > 1_500_000) return res.status(400).json({ error: 'Image too large — max ~1MB', field: 'avatar' });
    updates.push('avatar_data = ?'); params.push(avatar);
  }
  for (const [key, col] of Object.entries(PROFILE_FIELDS)) {
    if (body[key] !== undefined) { updates.push(`${col} = ?`); params.push(body[key]); }
  }
  if (body.settings !== undefined) {
    const merged = { ...j(req.user.settings_json, {}), ...body.settings };
    updates.push('settings_json = ?'); params.push(JSON.stringify(merged));
  }
  if (updates.length === 0) return res.json({ user: publicUser(req.user) });
  updates.push('updated_at = ?'); params.push(now());
  params.push(req.user.id);
  run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
  const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  mirrorUser(user);
  res.json({ user: publicUser(user) });
});

// Change password (requires the current password).
authRouter.post('/auth/change-password', requireAuth, asyncRoute(async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!(await verifyPassword(String(currentPassword ?? ''), req.user.password_hash))) {
    return res.status(403).json({ error: 'Current password is incorrect', field: 'currentPassword' });
  }
  const pwErr = validatePassword(newPassword ?? '');
  if (pwErr) return res.status(400).json({ error: pwErr, field: 'newPassword' });
  const passwordHash = await hashPassword(String(newPassword));
  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [passwordHash, now(), req.user.id]);
  mirrorUser(get('SELECT * FROM users WHERE id = ?', [req.user.id]));
  // Invalidate other sessions for safety; keep the current one.
  run('DELETE FROM sessions WHERE user_id = ? AND token != ?', [req.user.id, sessionTokenDigest(req.token)]);
  res.json({ ok: true });
}));

// Forgot password: issue a reset token internally. The public response is
// intentionally identical whether or not the account exists; tokens must only
// be delivered through a trusted email transport, never returned to clients.
authRouter.post('/auth/forgot-password', (req, res) => {
  const email = normalizedEmail(req.body?.email);
  const user = get('SELECT * FROM users WHERE email = ?', [email]);
  if (user && !user.deleted_at) {
    cleanupAuthTokens();
    const pending = get(
      'SELECT created_at FROM auth_tokens WHERE user_id = ? AND kind = ? AND used = 0 ORDER BY created_at DESC LIMIT 1',
      [user.id, 'password-reset']
    );
    const lastIssuedAt = Date.parse(pending?.created_at ?? '');
    const mayIssue = !Number.isFinite(lastIssuedAt)
      || Date.now() - lastIssuedAt >= passwordResetMinIntervalMs();
    if (mayIssue) {
      try {
        // Delivery belongs to the trusted mail transport. The raw token is
        // deliberately not included in this route's response.
        rotateAuthToken({ userId: user.id, kind: 'password-reset', ttlMs: passwordResetTtlMs() });
      } catch (error) {
        // Preserve the same public response for known and unknown addresses.
        if (!(error instanceof AuthTokenCapacityError)) throw error;
      }
    }
  }
  res.json({ ok: true, message: 'If this email has an account, password reset instructions will be sent.' });
});

authRouter.post('/auth/reset-password', asyncRoute(async (req, res) => {
  const { token, newPassword } = req.body ?? {};
  const cleanToken = typeof token === 'string' && /^[a-f0-9]{48}$/i.test(token) ? token : null;
  cleanupAuthTokens();
  const row = cleanToken
    ? get('SELECT * FROM auth_tokens WHERE token = ? AND kind = ? AND used = 0', [cleanToken, 'password-reset'])
    : null;
  if (!row || row.expires_at <= now()) return res.status(400).json({ error: 'This reset link is invalid or has expired' });
  const pwErr = validatePassword(newPassword ?? '');
  if (pwErr) return res.status(400).json({ error: pwErr, field: 'newPassword' });
  const passwordHash = await hashPassword(String(newPassword));
  let transactionStarted = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    transactionStarted = true;
    const current = get(
      'SELECT * FROM auth_tokens WHERE token = ? AND kind = ? AND used = 0 AND expires_at > ?',
      [cleanToken, 'password-reset', now()]
    );
    if (!current) {
      const invalid = new Error('This reset link is invalid or has expired');
      invalid.code = 'PASSWORD_RESET_TOKEN_INVALID';
      throw invalid;
    }
    run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [passwordHash, now(), current.user_id]);
    run('DELETE FROM auth_tokens WHERE user_id = ? AND kind = ?', [current.user_id, 'password-reset']);
    run('DELETE FROM sessions WHERE user_id = ?', [current.user_id]);
    db.exec('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      try { db.exec('ROLLBACK'); } catch { /* preserve the original reset failure */ }
    }
    if (error?.code === 'PASSWORD_RESET_TOKEN_INVALID') {
      return res.status(400).json({ error: error.message });
    }
    throw error;
  }
  mirrorUser(get('SELECT * FROM users WHERE id = ?', [row.user_id]));
  res.json({ ok: true });
}));

// Email verification (code issued at signup).
authRouter.post('/auth/verify-email', requireAuth, (req, res) => {
  const { code } = req.body ?? {};
  cleanupAuthTokens();
  const row = get('SELECT * FROM auth_tokens WHERE user_id = ? AND kind = ? AND used = 0 ORDER BY created_at DESC LIMIT 1', [req.user.id, 'email-verify']);
  if (!row || row.expires_at <= now()) {
    return res.status(400).json({
      error: 'No pending verification — request a new code',
      code: 'EMAIL_VERIFICATION_NOT_PENDING'
    });
  }

  const maximumAttempts = emailVerifyMaxAttempts();
  const attempts = Number.isInteger(row.attempts) ? row.attempts : 0;
  const matches = /^\d{6}$/.test(String(code ?? ''))
    && constantTimeMatch(String(code), String(row.code ?? ''), 'ember-email-verification-v1');
  if (!matches) {
    const nextAttempts = attempts + 1;
    if (nextAttempts >= maximumAttempts) {
      run('DELETE FROM auth_tokens WHERE token = ?', [row.token]);
      return res.status(429).json({
        error: 'Too many incorrect verification attempts. Request a new code.',
        code: 'EMAIL_VERIFICATION_ATTEMPTS_EXCEEDED',
        field: 'code',
        attemptsRemaining: 0
      });
    }
    run('UPDATE auth_tokens SET attempts = ? WHERE token = ?', [nextAttempts, row.token]);
    return res.status(400).json({
      error: 'Incorrect verification code',
      code: 'EMAIL_VERIFICATION_CODE_INVALID',
      field: 'code',
      attemptsRemaining: maximumAttempts - nextAttempts
    });
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    run('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?', [now(), req.user.id]);
    run('DELETE FROM auth_tokens WHERE user_id = ? AND kind = ?', [req.user.id, 'email-verify']);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve the verification failure */ }
    throw error;
  }
  mirrorUser(get('SELECT * FROM users WHERE id = ?', [req.user.id]));
  res.json({ ok: true, emailVerified: true });
});

authRouter.post('/auth/resend-email-code', requireAuth, (req, res) => {
  if (req.user.email_verified) {
    run('DELETE FROM auth_tokens WHERE user_id = ? AND kind = ?', [req.user.id, 'email-verify']);
    return res.json({ ok: true, emailVerified: true });
  }
  const code = issueEmailVerification(req.user.id);
  res.json({ ok: true, ...developmentVerificationValue(req, 'verifyCode', code) });
});

// Phone verification (optional): issue and confirm a code.
authRouter.post('/auth/verify-phone/start', requireAuth, (req, res) => {
  const code = secureSixDigitCode();
  rotateAuthToken({ userId: req.user.id, kind: 'phone-verify', code, ttlMs: DEFAULT_PHONE_VERIFY_TTL_MS });
  res.json({ ok: true, ...developmentVerificationValue(req, 'code', code) });
});

authRouter.post('/auth/verify-phone/confirm', requireAuth, (req, res) => {
  const { code } = req.body ?? {};
  cleanupAuthTokens();
  const row = get('SELECT * FROM auth_tokens WHERE user_id = ? AND kind = ? AND used = 0 ORDER BY created_at DESC LIMIT 1', [req.user.id, 'phone-verify']);
  if (!row || row.expires_at <= now()) return res.status(400).json({ error: 'No pending phone verification' });
  if (!constantTimeMatch(String(code ?? ''), String(row.code ?? ''), 'ember-phone-verification-v1')) {
    return res.status(400).json({ error: 'Incorrect code', field: 'code' });
  }
  run('UPDATE users SET phone_verified = 1, updated_at = ? WHERE id = ?', [now(), req.user.id]);
  run('DELETE FROM auth_tokens WHERE user_id = ? AND kind = ?', [req.user.id, 'phone-verify']);
  res.json({ ok: true, phoneVerified: true });
});

// Delete all sessions except the current one (used by "sign out other devices").
authRouter.post('/auth/sessions/revoke-others', requireAuth, (req, res) => {
  run('DELETE FROM sessions WHERE user_id = ? AND token != ?', [req.user.id, sessionTokenDigest(req.token)]);
  res.json({ ok: true });
});

// List active sessions (no raw tokens ever leave the server).
authRouter.get('/auth/sessions', requireAuth, (req, res) => {
  const rows = all(
    'SELECT id, token, created_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC',
    [req.user.id, now()]
  );
  const currentToken = sessionTokenDigest(req.token);
  res.json(rows.map((r) => ({ id: r.id, createdAt: r.created_at, expiresAt: r.expires_at, current: r.token === currentToken })));
});

// Revoke a single session by id.
authRouter.delete('/auth/sessions/:id', requireAuth, (req, res) => {
  const row = get('SELECT * FROM sessions WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!row) return res.status(404).json({ error: 'Session not found' });
  run('DELETE FROM sessions WHERE id = ?', [req.params.id]);
  res.json({ ok: true, wasCurrent: row.token === sessionTokenDigest(req.token) });
});

// Export the account's own data (profile + workspace + subscription) as JSON.
authRouter.get('/auth/export', requireAuth, (req, res) => {
  const workspace = ensureDefaultWorkspace(req.user.id);
  const subscription = get('SELECT plan_id, status, current_period_end FROM subscriptions WHERE workspace_id = ?', [workspace.id]);
  res.json({
    exportedAt: now(),
    user: publicUser(req.user),
    workspace: { id: workspace.id, name: workspace.name },
    subscription: subscription ?? null
  });
});

// Deactivate the account (soft delete): blocks login, scrubs the password,
// destroys sessions. Data stays referenced (workspaces/reports keep FK
// integrity) — a hard, cascading erase is a larger, separate operation.
authRouter.post('/auth/deactivate', requireAuth, asyncRoute(async (req, res) => {
  const { password } = req.body ?? {};
  if (!(await verifyPassword(String(password ?? ''), req.user.password_hash))) {
    return res.status(403).json({ error: 'Incorrect password', field: 'password' });
  }
  run('UPDATE users SET deleted_at = ?, password_hash = NULL, updated_at = ? WHERE id = ?', [now(), now(), req.user.id]);
  run('DELETE FROM sessions WHERE user_id = ?', [req.user.id]);
  mirrorUser(get('SELECT * FROM users WHERE id = ?', [req.user.id]));
  res.json({ ok: true });
}));
