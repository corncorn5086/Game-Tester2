import { Router } from 'express';
import { makeId } from '@ember/shared/constants';
import { get, run, now, j } from '../db.js';
import { createSession, destroySession, ensureDefaultWorkspace, hashPassword, publicUser, requireAuth, verifyPassword } from '../auth.js';
import { cloudUserByEmail } from '../supabase.js';

export const authRouter = Router();

authRouter.post('/auth/signup', (req, res) => {
  const { email, password, name } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  if (get('SELECT id FROM users WHERE email = ?', [email])) return res.status(409).json({ error: 'An account with this email already exists' });

  const id = makeId('usr');
  run('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', [
    id, String(email).toLowerCase(), name ?? null, hashPassword(String(password)), now()
  ]);
  const workspace = ensureDefaultWorkspace(id, name ? `${name}'s Workspace` : 'My Workspace');
  const token = createSession(id);
  res.status(201).json({ token, user: publicUser(get('SELECT * FROM users WHERE id = ?', [id])), workspace: { id: workspace.id, name: workspace.name } });
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

  if (!user || !verifyPassword(String(password ?? ''), user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = createSession(user.id);
  res.json({ token, user: publicUser(user), cloudImported: undefined });
});

authRouter.post('/auth/logout', requireAuth, (req, res) => {
  destroySession(req.token);
  res.json({ ok: true });
});

authRouter.post('/auth/forgot-password', (req, res) => {
  // Placeholder: no email transport configured yet. Responds identically
  // whether or not the account exists (no user enumeration).
  res.json({ ok: true, message: 'If this email has an account, a reset link will be sent once email delivery is configured (placeholder).' });
});

authRouter.get('/auth/me', requireAuth, (req, res) => {
  const workspace = ensureDefaultWorkspace(req.user.id);
  res.json({ user: publicUser(req.user), workspace: { id: workspace.id, name: workspace.name }, settings: j(req.user.settings_json, {}) });
});

authRouter.patch('/auth/me', requireAuth, (req, res) => {
  const { name, settings } = req.body ?? {};
  if (name !== undefined) run('UPDATE users SET name = ? WHERE id = ?', [name, req.user.id]);
  if (settings !== undefined) {
    const merged = { ...j(req.user.settings_json, {}), ...settings };
    run('UPDATE users SET settings_json = ? WHERE id = ?', [JSON.stringify(merged), req.user.id]);
  }
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', [req.user.id])) });
});
