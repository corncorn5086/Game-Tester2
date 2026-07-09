import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { makeId } from '@ember/shared/constants';
import { get, all, run, now, j } from '../db.js';
import { createSession, destroySession, ensureDefaultWorkspace, hashPassword, publicUser, requireAuth, verifyPassword, pickAvatarColor } from '../auth.js';
import { cloudUserByEmail, mirrorUser } from '../supabase.js';

export const authRouter = Router();

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validatePassword(pw) {
  if (String(pw).length < 8) return 'Password must be at least 8 characters';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) {
    return 'Password must include an uppercase letter, a lowercase letter and a number';
  }
  return null;
}

authRouter.post('/auth/signup', (req, res) => {
  const {
    email, password, name, username,
    dob, phone, address, role, userType, company, goal, tosAccepted,
    language, country
  } = req.body ?? {};

  if (!email || !EMAIL_RE.test(String(email))) return res.status(400).json({ error: 'A valid email is required', field: 'email' });
  const pwErr = validatePassword(password ?? '');
  if (pwErr) return res.status(400).json({ error: pwErr, field: 'password' });
  if (username && !USERNAME_RE.test(String(username))) return res.status(400).json({ error: 'Username must be 3–32 chars (letters, numbers, _ or .)', field: 'username' });
  if (!tosAccepted) return res.status(400).json({ error: 'You must accept the Terms and Privacy Policy', field: 'tosAccepted' });

  const normEmail = String(email).toLowerCase();
  if (get('SELECT id FROM users WHERE email = ?', [normEmail])) return res.status(409).json({ error: 'An account with this email already exists', field: 'email' });
  if (username && get('SELECT id FROM users WHERE username = ?', [username])) return res.status(409).json({ error: 'This username is taken', field: 'username' });

  const id = makeId('usr');
  const avatarColor = pickAvatarColor(normEmail);
  run(
    `INSERT INTO users (id, email, name, username, password_hash, dob, phone, address, role, user_type, company, goal, language, country, tos_accepted, avatar_color, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, normEmail, name ?? null, username ?? null, hashPassword(String(password)),
      dob ?? null, phone ?? null, address ?? null, role ?? null, userType ?? null, company ?? null, goal ?? null,
      language ?? 'en', country ?? null, 1, avatarColor, now(), now()
    ]
  );
  const workspace = ensureDefaultWorkspace(id, company ? `${company} Workspace` : name ? `${name}'s Workspace` : 'My Workspace');
  const token = createSession(id);
  const user = get('SELECT * FROM users WHERE id = ?', [id]);
  mirrorUser(user);

  // Issue an email verification code (returned here until email transport ships).
  const code = String(Math.floor(100000 + Math.random() * 900000));
  run('INSERT INTO auth_tokens (token, user_id, kind, code, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', [
    randomBytes(16).toString('hex'), id, 'email-verify', code, now(), new Date(Date.now() + 864e5).toISOString()
  ]);

  res.status(201).json({ token, user: publicUser(user), workspace: { id: workspace.id, name: workspace.name }, verifyCode: code });
});

authRouter.post('/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const normalized = String(email ?? '').toLowerCase();
  let user = get('SELECT * FROM users WHERE email = ?', [normalized]);

  // Cloud fallback: import the account (e.g. the Ember HQ admin) from
  // Supabase onto a fresh local install, then verify locally as usual.
  if (!user) {
    const cloud = await cloudUserByEmail(normalized);
    if (cloud?.password_hash) {
      run('INSERT OR IGNORE INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', [
        cloud.id, cloud.email, cloud.name ?? null, cloud.password_hash, cloud.created_at ?? now()
      ]);
      user = get('SELECT * FROM users WHERE email = ?', [normalized]);
    }
  }

  if (!user || user.deleted_at || !verifyPassword(String(password ?? ''), user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = createSession(user.id);
  res.json({ token, user: publicUser(user), workspace: workspaceFor(user.id) });
});

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
authRouter.post('/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!verifyPassword(String(currentPassword ?? ''), req.user.password_hash)) {
    return res.status(403).json({ error: 'Current password is incorrect', field: 'currentPassword' });
  }
  const pwErr = validatePassword(newPassword ?? '');
  if (pwErr) return res.status(400).json({ error: pwErr, field: 'newPassword' });
  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hashPassword(String(newPassword)), now(), req.user.id]);
  mirrorUser(get('SELECT * FROM users WHERE id = ?', [req.user.id]));
  // Invalidate other sessions for safety; keep the current one.
  run('DELETE FROM sessions WHERE user_id = ? AND token != ?', [req.user.id, req.token]);
  res.json({ ok: true });
});

// Forgot password: issue a reset token. Responds identically whether or not the
// account exists (no user enumeration). The token is returned here until email
// delivery is configured.
authRouter.post('/auth/forgot-password', (req, res) => {
  const email = String(req.body?.email ?? '').toLowerCase();
  const user = get('SELECT * FROM users WHERE email = ?', [email]);
  let resetToken;
  if (user) {
    resetToken = randomBytes(24).toString('hex');
    run('INSERT INTO auth_tokens (token, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [
      resetToken, user.id, 'password-reset', now(), new Date(Date.now() + 36e5).toISOString()
    ]);
  }
  res.json({ ok: true, message: 'If this email has an account, a reset link has been issued.', resetToken });
});

authRouter.post('/auth/reset-password', (req, res) => {
  const { token, newPassword } = req.body ?? {};
  const row = get('SELECT * FROM auth_tokens WHERE token = ? AND kind = ?', [token, 'password-reset']);
  if (!row || row.used || row.expires_at < now()) return res.status(400).json({ error: 'This reset link is invalid or has expired' });
  const pwErr = validatePassword(newPassword ?? '');
  if (pwErr) return res.status(400).json({ error: pwErr, field: 'newPassword' });
  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hashPassword(String(newPassword)), now(), row.user_id]);
  run('UPDATE auth_tokens SET used = 1 WHERE token = ?', [token]);
  run('DELETE FROM sessions WHERE user_id = ?', [row.user_id]);
  mirrorUser(get('SELECT * FROM users WHERE id = ?', [row.user_id]));
  res.json({ ok: true });
});

// Email verification (code issued at signup).
authRouter.post('/auth/verify-email', requireAuth, (req, res) => {
  const { code } = req.body ?? {};
  const row = get('SELECT * FROM auth_tokens WHERE user_id = ? AND kind = ? AND used = 0 ORDER BY created_at DESC LIMIT 1', [req.user.id, 'email-verify']);
  if (!row || row.expires_at < now()) return res.status(400).json({ error: 'No pending verification — request a new code' });
  if (String(code) !== row.code) return res.status(400).json({ error: 'Incorrect verification code', field: 'code' });
  run('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?', [now(), req.user.id]);
  run('UPDATE auth_tokens SET used = 1 WHERE token = ?', [row.token]);
  mirrorUser(get('SELECT * FROM users WHERE id = ?', [req.user.id]));
  res.json({ ok: true, emailVerified: true });
});

authRouter.post('/auth/resend-email-code', requireAuth, (req, res) => {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  run('INSERT INTO auth_tokens (token, user_id, kind, code, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', [
    randomBytes(16).toString('hex'), req.user.id, 'email-verify', code, now(), new Date(Date.now() + 864e5).toISOString()
  ]);
  res.json({ ok: true, verifyCode: code });
});

// Phone verification (optional): issue and confirm a code.
authRouter.post('/auth/verify-phone/start', requireAuth, (req, res) => {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  run('INSERT INTO auth_tokens (token, user_id, kind, code, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', [
    randomBytes(16).toString('hex'), req.user.id, 'phone-verify', code, now(), new Date(Date.now() + 6e5).toISOString()
  ]);
  res.json({ ok: true, code }); // returned until SMS transport ships
});

authRouter.post('/auth/verify-phone/confirm', requireAuth, (req, res) => {
  const { code } = req.body ?? {};
  const row = get('SELECT * FROM auth_tokens WHERE user_id = ? AND kind = ? AND used = 0 ORDER BY created_at DESC LIMIT 1', [req.user.id, 'phone-verify']);
  if (!row || row.expires_at < now()) return res.status(400).json({ error: 'No pending phone verification' });
  if (String(code) !== row.code) return res.status(400).json({ error: 'Incorrect code', field: 'code' });
  run('UPDATE users SET phone_verified = 1, updated_at = ? WHERE id = ?', [now(), req.user.id]);
  run('UPDATE auth_tokens SET used = 1 WHERE token = ?', [row.token]);
  res.json({ ok: true, phoneVerified: true });
});

// Delete all sessions except the current one (used by "sign out other devices").
authRouter.post('/auth/sessions/revoke-others', requireAuth, (req, res) => {
  run('DELETE FROM sessions WHERE user_id = ? AND token != ?', [req.user.id, req.token]);
  res.json({ ok: true });
});

// List active sessions (no raw tokens ever leave the server).
authRouter.get('/auth/sessions', requireAuth, (req, res) => {
  const rows = all(
    'SELECT id, token, created_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC',
    [req.user.id, now()]
  );
  res.json(rows.map((r) => ({ id: r.id, createdAt: r.created_at, expiresAt: r.expires_at, current: r.token === req.token })));
});

// Revoke a single session by id.
authRouter.delete('/auth/sessions/:id', requireAuth, (req, res) => {
  const row = get('SELECT * FROM sessions WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!row) return res.status(404).json({ error: 'Session not found' });
  run('DELETE FROM sessions WHERE id = ?', [req.params.id]);
  res.json({ ok: true, wasCurrent: row.token === req.token });
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
authRouter.post('/auth/deactivate', requireAuth, (req, res) => {
  const { password } = req.body ?? {};
  if (!verifyPassword(String(password ?? ''), req.user.password_hash)) {
    return res.status(403).json({ error: 'Incorrect password', field: 'password' });
  }
  run('UPDATE users SET deleted_at = ?, password_hash = NULL, updated_at = ? WHERE id = ?', [now(), now(), req.user.id]);
  run('DELETE FROM sessions WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
});
