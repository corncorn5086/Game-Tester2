import { db, now } from './db.js';

const MINUTE_MS = 60_000;
const DEFAULT_GLOBAL_OPERATIONS_PER_MINUTE = 30;
const DEFAULT_GLOBAL_CONCURRENCY = 4;
const DEFAULT_DAILY_USER_OPERATIONS = 40;
const DEFAULT_DAILY_GLOBAL_OPERATIONS = 400;
const DEFAULT_RETENTION_DAYS = 8;
const GLOBAL_SCOPE_ID = 'all-users';
const OPERATION_KINDS = new Set(['summary', 'triage']);

let minuteWindow = { startedAt: 0, count: 0 };
let activeOperations = 0;
let lastCleanupDay = null;

db.exec(`
  CREATE TABLE IF NOT EXISTS ai_daily_usage (
    day TEXT NOT NULL,
    scope TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    operations INTEGER NOT NULL DEFAULT 0,
    summary_operations INTEGER NOT NULL DEFAULT 0,
    triage_operations INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (day, scope, scope_id),
    CHECK (scope IN ('user', 'global')),
    CHECK (operations >= 0),
    CHECK (summary_operations >= 0),
    CHECK (triage_operations >= 0)
  );
  CREATE INDEX IF NOT EXISTS idx_ai_daily_usage_day ON ai_daily_usage(day);
`);

export class AICostLimitError extends Error {
  constructor(code, message, retryAfter) {
    super(message);
    this.name = 'AICostLimitError';
    this.code = code;
    this.statusCode = 429;
    this.retryAfter = Math.max(1, Math.ceil(retryAfter || 1));
  }
}

/** Production paid-AI access requires a verified Ember account. */
export function requireProductionAIAccess(req, res, next) {
  if (hasProductionAIAccess(req.user, req.app?.locals?.runtimeConfig)) return next();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(403).json({
    error: 'Verify your Ember account before using managed AI.',
    code: 'AI_ACCOUNT_VERIFICATION_REQUIRED',
    managed: true
  });
}

/** Shared by the status endpoint so Desktop never advertises unusable AI. */
export function hasProductionAIAccess(user, runtimeConfig) {
  if (runtimeConfig?.production !== true) return true;
  const verified = user?.email_verified === 1
    || user?.email_verified === true
    || user?.emailVerified === true;
  return verified;
}

/**
 * Reserve one real provider operation. In-memory global guards are checked
 * first; the durable per-user/global counters are then incremented atomically.
 */
export function beginProviderOperation({ userId, kind, currentTime = Date.now() }) {
  const cleanUserId = String(userId || '').trim();
  if (!cleanUserId || cleanUserId.length > 200) throw new TypeError('A valid AI budget userId is required');
  if (!OPERATION_KINDS.has(kind)) throw new TypeError('AI operation kind must be summary or triage');
  const current = Number.isFinite(currentTime) ? Math.floor(currentTime) : Date.now();
  refreshMinuteWindow(current);

  const concurrencyLimit = configuredLimit('EMBER_AI_GLOBAL_CONCURRENCY_LIMIT', DEFAULT_GLOBAL_CONCURRENCY, 100);
  if (activeOperations >= concurrencyLimit) {
    throw new AICostLimitError(
      'AI_GLOBAL_CONCURRENCY_LIMITED',
      'Ember AI is handling its maximum number of provider operations. Try again shortly.',
      1
    );
  }

  const minuteLimit = configuredLimit(
    'EMBER_AI_GLOBAL_OPERATIONS_PER_MINUTE',
    DEFAULT_GLOBAL_OPERATIONS_PER_MINUTE,
    100_000
  );
  if (minuteWindow.count >= minuteLimit) {
    throw new AICostLimitError(
      'AI_GLOBAL_RATE_LIMITED',
      'Ember AI reached its global provider-operation limit. Try again shortly.',
      Math.max(1, Math.ceil((MINUTE_MS - (current - minuteWindow.startedAt)) / 1000))
    );
  }

  const usage = reserveDailyBudget(cleanUserId, kind, current);
  minuteWindow.count += 1;
  activeOperations += 1;
  let released = false;
  return {
    usage,
    release() {
      if (released) return;
      released = true;
      activeOperations = Math.max(0, activeOperations - 1);
    }
  };
}

export async function withProviderOperation(req, kind, signal, operation) {
  if (signal?.aborted) return operation();
  const permit = beginProviderOperation({ userId: req.user?.id, kind });
  try {
    return await operation();
  } finally {
    permit.release();
  }
}

function reserveDailyBudget(userId, kind, current) {
  const day = utcDay(current);
  const userLimit = configuredLimit(
    'EMBER_AI_DAILY_USER_OPERATION_LIMIT',
    DEFAULT_DAILY_USER_OPERATIONS,
    1_000_000
  );
  const globalLimit = configuredLimit(
    'EMBER_AI_DAILY_GLOBAL_OPERATION_LIMIT',
    DEFAULT_DAILY_GLOBAL_OPERATIONS,
    10_000_000
  );
  const retryAfter = secondsUntilNextUtcDay(current);
  let transactionStarted = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    transactionStarted = true;
    cleanupOldUsage(day, current);
    const userUsage = usageCount(day, 'user', userId);
    const globalUsage = usageCount(day, 'global', GLOBAL_SCOPE_ID);
    let limitError = null;
    if (userUsage >= userLimit) {
      limitError = new AICostLimitError(
        'AI_DAILY_USER_BUDGET_EXCEEDED',
        'This Ember account reached its managed-AI daily operation budget.',
        retryAfter
      );
    } else if (globalUsage >= globalLimit) {
      limitError = new AICostLimitError(
        'AI_DAILY_GLOBAL_BUDGET_EXCEEDED',
        'Ember AI reached its daily provider-operation budget.',
        retryAfter
      );
    }
    if (limitError) {
      // Persist retention cleanup even when today's provider budget is full.
      db.exec('COMMIT');
      transactionStarted = false;
      lastCleanupDay = day;
      throw limitError;
    }

    incrementUsage(day, 'user', userId, kind);
    incrementUsage(day, 'global', GLOBAL_SCOPE_ID, kind);
    db.exec('COMMIT');
    transactionStarted = false;
    lastCleanupDay = day;
    return {
      day,
      userOperations: userUsage + 1,
      userLimit,
      globalOperations: globalUsage + 1,
      globalLimit
    };
  } catch (error) {
    if (transactionStarted) {
      try { db.exec('ROLLBACK'); } catch { /* preserve the original failure */ }
    }
    throw error;
  }
}

function incrementUsage(day, scope, scopeId, kind) {
  const summary = kind === 'summary' ? 1 : 0;
  const triage = kind === 'triage' ? 1 : 0;
  db.prepare(`
    INSERT INTO ai_daily_usage (
      day, scope, scope_id, operations, summary_operations, triage_operations, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(day, scope, scope_id) DO UPDATE SET
      operations = operations + 1,
      summary_operations = summary_operations + excluded.summary_operations,
      triage_operations = triage_operations + excluded.triage_operations,
      updated_at = excluded.updated_at
  `).run(day, scope, scopeId, summary, triage, now());
}

function usageCount(day, scope, scopeId) {
  const row = db.prepare(
    'SELECT operations FROM ai_daily_usage WHERE day = ? AND scope = ? AND scope_id = ?'
  ).get(day, scope, scopeId);
  return Number.isInteger(row?.operations) ? row.operations : 0;
}

function cleanupOldUsage(day, current) {
  if (lastCleanupDay === day) return;
  const retention = configuredLimit('EMBER_AI_BUDGET_RETENTION_DAYS', DEFAULT_RETENTION_DAYS, 366);
  const cutoff = utcDay(current - ((retention - 1) * 24 * 60 * 60 * 1000));
  db.prepare('DELETE FROM ai_daily_usage WHERE day < ?').run(cutoff);
}

function configuredLimit(name, fallback, maximum) {
  const raw = String(process.env[name] ?? '').trim();
  if (!/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : fallback;
}

function refreshMinuteWindow(current) {
  if (!minuteWindow.startedAt || current < minuteWindow.startedAt || current - minuteWindow.startedAt >= MINUTE_MS) {
    minuteWindow = { startedAt: current, count: 0 };
  }
}

function utcDay(current = Date.now()) {
  return new Date(current).toISOString().slice(0, 10);
}

function secondsUntilNextUtcDay(current) {
  const date = new Date(current);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - current) / 1000));
}

/** Reset process-local guards only; durable daily usage intentionally survives. */
export function resetAICostRuntimeState() {
  minuteWindow = { startedAt: 0, count: 0 };
  activeOperations = 0;
  lastCleanupDay = null;
}

export function aiCostRuntimeStats() {
  return { minuteOperations: minuteWindow.count, activeOperations };
}

export function aiDailyUsageForTest(day = utcDay()) {
  return db.prepare(`
    SELECT day, scope, scope_id AS scopeId, operations,
           summary_operations AS summaryOperations,
           triage_operations AS triageOperations
    FROM ai_daily_usage WHERE day = ? ORDER BY scope, scope_id
  `).all(day);
}

export function clearAIDailyUsageForTest() {
  db.exec('DELETE FROM ai_daily_usage');
  lastCleanupDay = null;
}
