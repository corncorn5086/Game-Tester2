/**
 * Abuse controls for unauthenticated auth endpoints.
 *
 * Keys are HMACs of the effective client address with an ephemeral process
 * salt. Raw addresses are never retained or logged. Forwarded addresses are
 * considered only when Express trust proxy is explicitly enabled.
 */
import { createHmac, randomBytes } from 'node:crypto';

const CLEANUP_INTERVAL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 10_000;
const ipHashSalt = randomBytes(32);
const windows = {
  signup: new Map(),
  login: new Map(),
  forgotPassword: new Map(),
  resendEmail: new Map(),
  operatorBootstrap: new Map()
};
let lastCleanupAt = 0;

const POLICY = {
  signup: {
    defaultLimit: 5,
    defaultWindowMs: 10 * 60_000,
    limitEnv: 'EMBER_AUTH_SIGNUP_RATE_LIMIT',
    windowEnv: 'EMBER_AUTH_SIGNUP_RATE_WINDOW_MS',
    code: 'AUTH_SIGNUP_RATE_LIMITED'
  },
  login: {
    defaultLimit: 15,
    defaultWindowMs: 5 * 60_000,
    limitEnv: 'EMBER_AUTH_LOGIN_RATE_LIMIT',
    windowEnv: 'EMBER_AUTH_LOGIN_RATE_WINDOW_MS',
    code: 'AUTH_LOGIN_RATE_LIMITED'
  },
  forgotPassword: {
    defaultLimit: 5,
    defaultWindowMs: 15 * 60_000,
    limitEnv: 'EMBER_AUTH_FORGOT_PASSWORD_RATE_LIMIT',
    windowEnv: 'EMBER_AUTH_FORGOT_PASSWORD_RATE_WINDOW_MS',
    code: 'AUTH_FORGOT_PASSWORD_RATE_LIMITED'
  },
  resendEmail: {
    defaultLimit: 3,
    defaultWindowMs: 15 * 60_000,
    limitEnv: 'EMBER_AUTH_RESEND_EMAIL_RATE_LIMIT',
    windowEnv: 'EMBER_AUTH_RESEND_EMAIL_RATE_WINDOW_MS',
    code: 'AUTH_RESEND_EMAIL_RATE_LIMITED'
  },
  operatorBootstrap: {
    defaultLimit: 5,
    defaultWindowMs: 15 * 60_000,
    limitEnv: 'EMBER_AUTH_OPERATOR_BOOTSTRAP_RATE_LIMIT',
    windowEnv: 'EMBER_AUTH_OPERATOR_BOOTSTRAP_RATE_WINDOW_MS',
    code: 'AUTH_OPERATOR_BOOTSTRAP_RATE_LIMITED'
  }
};

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function policyFor(kind) {
  const policy = POLICY[kind];
  return {
    ...policy,
    limit: positiveInteger(process.env[policy.limitEnv], policy.defaultLimit),
    windowMs: positiveInteger(process.env[policy.windowEnv], policy.defaultWindowMs)
  };
}

function maxEntries() {
  return positiveInteger(process.env.EMBER_AUTH_RATE_LIMIT_MAX_ENTRIES, DEFAULT_MAX_ENTRIES);
}

function effectiveAddress(req) {
  return req.app?.get('trust proxy')
    ? req.ip
    : (req.socket?.remoteAddress || req.ip || 'unknown');
}

function clientKey(req) {
  return createHmac('sha256', ipHashSalt).update(effectiveAddress(req)).digest('base64url');
}

function pruneMap(map, current, targetSize) {
  for (const [key, window] of map) {
    if (window.expiresAt <= current) map.delete(key);
  }
  if (map.size > targetSize) {
    const excess = map.size - targetSize;
    const oldest = [...map.entries()]
      .sort((a, b) => a[1].startedAt - b[1].startedAt)
      .slice(0, excess);
    for (const [key] of oldest) map.delete(key);
  }
}

function cleanupWindows(current = Date.now(), force = false) {
  const maximum = maxEntries();
  const atCapacity = Object.values(windows).some((map) => map.size >= maximum);
  if (!force && !atCapacity && current - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  for (const map of Object.values(windows)) pruneMap(map, current, maximum);
  lastCleanupAt = current;
}

function consume(kind, key, current) {
  const policy = policyFor(kind);
  const map = windows[kind];
  let window = map.get(key);
  if (!window || window.expiresAt <= current) {
    if (!window && map.size >= maxEntries()) {
      const earliestExpiry = Math.min(...[...map.values()].map((entry) => entry.expiresAt));
      return {
        ...policy,
        allowed: false,
        remaining: 0,
        retryAfter: Math.max(1, Math.ceil((earliestExpiry - current) / 1000))
      };
    }
    window = { startedAt: current, expiresAt: current + policy.windowMs, count: 0 };
    map.set(key, window);
  }
  if (window.count >= policy.limit) {
    return {
      ...policy,
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((window.expiresAt - current) / 1000))
    };
  }
  window.count += 1;
  return { ...policy, allowed: true, remaining: Math.max(0, policy.limit - window.count), retryAfter: 0 };
}

function limiter(kind) {
  return (req, res, next) => {
    if (req.method !== 'POST') return next();
    const current = Date.now();
    cleanupWindows(current);
    const result = consume(kind, clientKey(req), current);
    res.setHeader('RateLimit-Limit', String(result.limit));
    res.setHeader('RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfter));
      return res.status(429).json({
        error: 'Too many authentication attempts. Try again later.',
        code: result.code
      });
    }
    next();
  };
}

export const signupRateLimit = limiter('signup');
export const loginRateLimit = limiter('login');
export const forgotPasswordRateLimit = limiter('forgotPassword');
export const resendEmailRateLimit = limiter('resendEmail');
export const operatorBootstrapRateLimit = limiter('operatorBootstrap');

/** Test-only reset and observability; no client-facing route exposes this. */
export function resetAuthRateLimits() {
  for (const map of Object.values(windows)) map.clear();
  lastCleanupAt = 0;
}

export function authRateLimitStats() {
  return Object.fromEntries(Object.entries(windows).map(([kind, map]) => [kind, map.size]));
}

export function cleanupAuthRateLimitsForTest(current) {
  cleanupWindows(current, true);
}
