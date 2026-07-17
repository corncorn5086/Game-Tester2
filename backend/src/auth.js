/**
 * Minimal but real auth: asynchronously scrypt-hashed passwords + opaque
 * session tokens whose one-way digests are the only values persisted.
 * Designed to be swapped for Supabase Auth / OAuth later — the rest of the
 * app only uses req.user and requireAuth/optionalAuth.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { makeId } from '@ember/shared/constants';
import { all, db, get, run, now } from './db.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RAW_SESSION_TOKEN_RE = /^[a-f0-9]{64}$/i;
const SESSION_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const SCRYPT_SALT_RE = /^[a-f0-9]{32}$/i;
const SCRYPT_HASH_RE = /^[a-f0-9]{128}$/i;
const DEFAULT_SCRYPT_CONCURRENCY = 2;
const MAX_SCRYPT_CONCURRENCY = 8;
const DEFAULT_SCRYPT_QUEUE_LIMIT = 64;
const MAX_SCRYPT_QUEUE_LIMIT = 1_000;
const DEFAULT_AUTH_TOKEN_MAX_ROWS = 10_000;
const MAX_AUTH_TOKEN_MAX_ROWS = 1_000_000;
const AUTH_TOKEN_CHECKPOINT_INTERVAL_MS = 60_000;

let activeScryptWork = 0;
const scryptQueue = [];
let lastAuthTokenCheckpointAt = 0;

function scryptConcurrencyLimit() {
  const configured = Number.parseInt(String(process.env.EMBER_AUTH_SCRYPT_CONCURRENCY ?? ''), 10);
  return Number.isSafeInteger(configured) && configured >= 1
    ? Math.min(configured, MAX_SCRYPT_CONCURRENCY)
    : DEFAULT_SCRYPT_CONCURRENCY;
}

function scryptQueueLimit() {
  const configured = Number.parseInt(String(process.env.EMBER_AUTH_SCRYPT_QUEUE_LIMIT ?? ''), 10);
  return Number.isSafeInteger(configured) && configured >= 0
    ? Math.min(configured, MAX_SCRYPT_QUEUE_LIMIT)
    : DEFAULT_SCRYPT_QUEUE_LIMIT;
}

export class AuthCryptoBusyError extends Error {
  constructor() {
    super('Authentication capacity is temporarily full.');
    this.name = 'AuthCryptoBusyError';
    this.code = 'AUTH_CRYPTO_BUSY';
  }
}

async function withScryptSlot(work) {
  if (activeScryptWork >= scryptConcurrencyLimit()) {
    if (scryptQueue.length >= scryptQueueLimit()) throw new AuthCryptoBusyError();
    await new Promise((resolve) => scryptQueue.push(resolve));
  } else {
    activeScryptWork += 1;
  }
  try {
    return await work();
  } finally {
    const next = scryptQueue.shift();
    if (next) next();
    else activeScryptWork -= 1;
  }
}

function derivePasswordKey(password, salt) {
  return withScryptSlot(() => new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  }));
}

/** Exposed for focused operational tests; never includes passwords or hashes. */
export function scryptWorkStats() {
  return {
    active: activeScryptWork,
    queued: scryptQueue.length,
    limit: scryptConcurrencyLimit(),
    queueLimit: scryptQueueLimit()
  };
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await derivePasswordKey(password, salt)).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored ?? '').split(':');
  if (scheme !== 'scrypt' || !SCRYPT_SALT_RE.test(salt ?? '') || !SCRYPT_HASH_RE.test(hash ?? '')) return false;
  const candidate = await derivePasswordKey(password, salt);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** Convert a client-held opaque token to its persistent one-way identifier. */
export function sessionTokenDigest(token) {
  const raw = String(token ?? '');
  if (!RAW_SESSION_TOKEN_RE.test(raw)) return null;
  return `sha256:${createHash('sha256').update(raw, 'utf8').digest('hex')}`;
}

/**
 * Preserve valid sessions created by older builds while eliminating their
 * plaintext database values. Malformed legacy rows are invalidated.
 */
export function migrateLegacySessionTokens() {
  let migrated = 0;
  let invalidated = 0;
  db.exec('PRAGMA secure_delete = ON');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of all('SELECT id, token FROM sessions')) {
      if (SESSION_DIGEST_RE.test(String(row.token ?? ''))) continue;
      const digest = sessionTokenDigest(row.token);
      const duplicate = digest ? get('SELECT id FROM sessions WHERE token = ?', [digest]) : null;
      if (!digest || (duplicate && duplicate.id !== row.id)) {
        run('DELETE FROM sessions WHERE id = ?', [row.id]);
        invalidated += 1;
        continue;
      }
      run('UPDATE sessions SET token = ? WHERE id = ?', [digest, row.id]);
      migrated += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* retain the original migration error */ }
    throw error;
  }
  if (migrated || invalidated) db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  return { migrated, invalidated };
}

migrateLegacySessionTokens();

function authTokenRowLimit() {
  const configured = Number.parseInt(String(process.env.EMBER_AUTH_TOKEN_MAX_ROWS ?? ''), 10);
  return Number.isSafeInteger(configured) && configured >= 1
    ? Math.min(configured, MAX_AUTH_TOKEN_MAX_ROWS)
    : DEFAULT_AUTH_TOKEN_MAX_ROWS;
}

export class AuthTokenCapacityError extends Error {
  constructor() {
    super('Authentication token storage is temporarily full.');
    this.name = 'AuthTokenCapacityError';
    this.code = 'AUTH_TOKEN_CAPACITY_REACHED';
  }
}

/**
 * Remove unusable persistent auth tokens. The table contains only short-lived
 * delivery credentials; used and expired rows have no audit value and are
 * deliberately discarded so neither the database nor its WAL can grow without
 * bound. A throttled passive checkpoint lets SQLite recycle WAL pages without
 * blocking normal readers.
 */
export function cleanupAuthTokens({ currentTime = Date.now(), checkpoint = true } = {}) {
  const current = Number.isFinite(currentTime) ? Math.floor(currentTime) : Date.now();
  const result = run('DELETE FROM auth_tokens WHERE used != 0 OR expires_at <= ?', [new Date(current).toISOString()]);
  const removed = Number(result?.changes ?? 0);
  if (checkpoint && removed > 0 && current - lastAuthTokenCheckpointAt >= AUTH_TOKEN_CHECKPOINT_INTERVAL_MS) {
    try { db.exec('PRAGMA wal_checkpoint(PASSIVE)'); } catch { /* SQLite auto-checkpoint remains the fallback */ }
    lastAuthTokenCheckpointAt = current;
  }
  return removed;
}

/** Fail before starting account creation when no persistent token slot exists. */
export function ensureAuthTokenCapacity({ currentTime = Date.now() } = {}) {
  cleanupAuthTokens({ currentTime });
  const count = Number(get('SELECT COUNT(*) AS count FROM auth_tokens')?.count ?? 0);
  if (count >= authTokenRowLimit()) throw new AuthTokenCapacityError();
  return { count, limit: authTokenRowLimit() };
}

/**
 * Issue exactly one active token for a user/kind pair. Rotation and the global
 * persistent cap happen in one write transaction, so a resend invalidates the
 * previous credential before the new one becomes visible.
 */
export function rotateAuthToken({ userId, kind, code = null, ttlMs, currentTime = Date.now() }) {
  const cleanUserId = String(userId ?? '').trim();
  const cleanKind = String(kind ?? '').trim();
  const lifetime = Number(ttlMs);
  if (!cleanUserId || cleanUserId.length > 200) throw new TypeError('A valid auth-token userId is required');
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(cleanKind)) throw new TypeError('A valid auth-token kind is required');
  if (!Number.isSafeInteger(lifetime) || lifetime < 1_000 || lifetime > 7 * 24 * 60 * 60 * 1000) {
    throw new TypeError('A bounded auth-token ttlMs is required');
  }
  if (code !== null && (typeof code !== 'string' || code.length > 256)) {
    throw new TypeError('Auth-token code must be a short string or null');
  }

  const current = Number.isFinite(currentTime) ? Math.floor(currentTime) : Date.now();
  const createdAt = new Date(current).toISOString();
  const expiresAt = new Date(current + lifetime).toISOString();
  const token = randomBytes(24).toString('hex');
  cleanupAuthTokens({ currentTime: current });

  let transactionStarted = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    transactionStarted = true;
    run('DELETE FROM auth_tokens WHERE user_id = ? AND kind = ?', [cleanUserId, cleanKind]);
    const count = Number(get('SELECT COUNT(*) AS count FROM auth_tokens')?.count ?? 0);
    if (count >= authTokenRowLimit()) throw new AuthTokenCapacityError();
    run(
      'INSERT INTO auth_tokens (token, user_id, kind, code, created_at, expires_at, used, attempts) VALUES (?, ?, ?, ?, ?, ?, 0, 0)',
      [token, cleanUserId, cleanKind, code, createdAt, expiresAt]
    );
    db.exec('COMMIT');
    transactionStarted = false;
    return { token, createdAt, expiresAt };
  } catch (error) {
    if (transactionStarted) {
      try { db.exec('ROLLBACK'); } catch { /* preserve the original issuance failure */ }
    }
    throw error;
  }
}

/** Operational/test observability; never returns token or code material. */
export function authTokenStats() {
  return {
    rows: Number(get('SELECT COUNT(*) AS count FROM auth_tokens')?.count ?? 0),
    limit: authTokenRowLimit()
  };
}

// Bound legacy databases immediately on process start. Shutdown performs the
// final truncating WAL checkpoint in closeDatabase().
cleanupAuthTokens();

export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const digest = sessionTokenDigest(token);
  const id = makeId('ses');
  run('INSERT INTO sessions (id, token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    digest,
    userId,
    now(),
    new Date(Date.now() + SESSION_TTL_MS).toISOString()
  ]);
  return token;
}

export function destroySession(token) {
  const digest = sessionTokenDigest(token);
  if (digest) run('DELETE FROM sessions WHERE token = ?', [digest]);
}

export function userForToken(token) {
  const digest = sessionTokenDigest(token);
  if (!digest) return null;
  const session = get('SELECT * FROM sessions WHERE token = ?', [digest]);
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
