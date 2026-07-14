/**
 * Security middleware: CORS allowlist, basic security headers and an
 * in-memory rate limiter for the auth endpoints.
 *
 * Local-first defaults: any localhost/127.0.0.1 origin is allowed (the web
 * site, the desktop renderer and the Electron static server all live on
 * random loopback ports). Extra origins come from CORS_ORIGINS in .env —
 * never `*` with credentials.
 */

const EXTRA_ORIGINS = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

const LOOPBACK_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export function corsAllowlist(req, res, next) {
  const origin = req.headers.origin;
  if (origin && (LOOPBACK_RE.test(origin) || EXTRA_ORIGINS.includes(origin.replace(/\/$/, '')))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  // Non-browser clients (agent CLI, curl) send no Origin and need no CORS.
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}

const buckets = new Map();
const DISABLED = process.env.EMBER_RATE_LIMITS === 'off';

/**
 * Fixed-window in-memory limiter, keyed by IP + name. Enough to blunt
 * credential stuffing on a local-first server; swap for a store-backed
 * limiter when the backend is deployed multi-instance.
 */
export function rateLimit(name, max, windowMs = 15 * 60 * 1000) {
  return (req, res, next) => {
    if (DISABLED) return next();
    const key = `${req.ip ?? req.socket?.remoteAddress ?? '?'}|${name}`;
    const nowMs = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || nowMs >= bucket.resetAt) {
      bucket = { count: 0, resetAt: nowMs + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - nowMs) / 1000));
      return res.status(429).json({ error: 'Too many attempts — try again later.' });
    }
    next();
  };
}

// Prune stale buckets so long-running servers don't accumulate them.
setInterval(() => {
  const nowMs = Date.now();
  for (const [key, bucket] of buckets) if (nowMs >= bucket.resetAt) buckets.delete(key);
}, 60_000).unref();
