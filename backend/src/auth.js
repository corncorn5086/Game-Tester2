/**
 * Minimal but real auth: scrypt-hashed passwords + opaque session tokens.
 * Designed to be swapped for Supabase Auth / OAuth later — the rest of the
 * app only uses req.user and requireAuth/optionalAuth.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { makeId } from '@ember/shared/constants';
import { get, run, now } from './db.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored ?? '').split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const id = makeId('ses');
  run('INSERT INTO sessions (id, token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    token,
    userId,
    now(),
    new Date(Date.now() + SESSION_TTL_MS).toISOString()
  ]);
  return token;
}

export function destroySession(token) {
  run('DELETE FROM sessions WHERE token = ?', [token]);
}

export function userForToken(token) {
  if (!token) return null;
  const session = get('SELECT * FROM sessions WHERE token = ?', [token]);
  if (!session || session.expires_at < now()) return null;
  const user = get('SELECT * FROM users WHERE id = ?', [session.user_id]);
  if (!user || user.deleted_at) return null;
  return user;
}

/** Attach req.user if a valid Bearer token is present; never blocks. */
export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  req.user = userForToken(token);
  req.token = token;
  next();
}

/** Blocks unless authenticated. Local-only setups can skip auth entirely. */
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required. POST /auth/login first.' });
  next();
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    username: user.username ?? null,
    dob: user.dob ?? null,
    phone: user.phone ?? null,
    address: user.address ?? null,
    role: user.role ?? null,
    userType: user.user_type ?? null,
    company: user.company ?? null,
    goal: user.goal ?? null,
    language: user.language ?? 'en',
    country: user.country ?? null,
    avatarColor: user.avatar_color ?? null,
    avatarData: user.avatar_data ?? null,
    emailVerified: !!user.email_verified,
    phoneVerified: !!user.phone_verified,
    tosAccepted: !!user.tos_accepted,
    createdAt: user.created_at
  };
}

const AVATAR_COLORS = ['#ff4d00', '#ff8a50', '#f59e0b', '#34d399', '#60a5fa', '#c58bff', '#f472b6'];
export function pickAvatarColor(seed = '') {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function ensureDefaultWorkspace(userId, name = 'My Workspace') {
  const existing = get('SELECT * FROM workspaces WHERE owner_id = ?', [userId]);
  if (existing) return existing;
  const id = makeId('ws');
  run('INSERT INTO workspaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)', [id, name, userId, now()]);
  run('INSERT INTO team_members (id, workspace_id, user_id, email, role, status, invited_at) SELECT ?, ?, id, email, ?, ?, ? FROM users WHERE id = ?', [
    makeId('tm'), id, 'owner', 'active', now(), userId
  ]);
  run('INSERT INTO subscriptions (id, workspace_id, plan_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
    makeId('sub'), id, 'free', 'active', now(), now()
  ]);
  return get('SELECT * FROM workspaces WHERE id = ?', [id]);
}
