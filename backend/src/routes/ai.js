/**
 * Server-managed AI proxy.
 *
 * Provider credentials are read only by @ember/agent from this backend
 * process' environment. Clients can neither submit nor retrieve a provider
 * key. Every billed operation requires an authenticated Ember session.
 */
import { Router } from 'express';
import { createHmac, randomBytes } from 'node:crypto';
import { aiStatus, maskSecrets, summarizeReport, triageBug } from '@ember/agent';
import { requireAuth } from '../auth.js';
import {
  AICostLimitError,
  hasProductionAIAccess,
  requireProductionAIAccess,
  resetAICostRuntimeState,
  withProviderOperation
} from '../ai-cost-guard.js';
import { aiReadinessSnapshot } from '../ai-readiness.js';

const MAX_TRIAGE_BUGS = 3;
const DEFAULT_RATE_LIMIT = 12;
const DEFAULT_IP_RATE_LIMIT = 24;
const DEFAULT_CONCURRENCY_LIMIT = 2;
const DEFAULT_MAX_RATE_ENTRIES = 10_000;
const RATE_WINDOW_MS = 60_000;
const PROVIDERS = new Set(['auto', 'openai', 'claude']);
const FORBIDDEN_CLIENT_FIELDS = ['apiKey', 'openaiApiKey', 'anthropicApiKey', 'credentials', 'provider'];
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const rateWindows = new Map();
const ipRateWindows = new Map();
const activeRequests = new Map();
const ipHashSalt = randomBytes(32);
let lastRateCleanupAt = 0;

export const aiRouter = Router();

function serverPreference(runtimeConfig = null) {
  const configured = String(runtimeConfig?.aiProvider ?? process.env.EMBER_AI_PROVIDER ?? 'auto').trim().toLowerCase();
  if (!PROVIDERS.has(configured)) {
    return { valid: false, preferred: null };
  }
  return { valid: true, preferred: configured === 'auto' ? undefined : configured };
}

function managedStatus(req) {
  const preference = serverPreference(req.app?.locals?.runtimeConfig);
  const authenticated = !!req.user;
  const readiness = aiReadinessSnapshot();
  if (!preference.valid) {
    return {
      managed: true,
      enabled: false,
      provider: null,
      model: null,
      requiresAuthentication: true,
      authenticated,
      authorized: false,
      readiness: { ready: false, state: readiness.state, checkedAt: readiness.checkedAt },
      message: 'Ember AI is temporarily unavailable.',
      reason: 'invalid_server_configuration'
    };
  }

  const status = aiStatus(preference.preferred);
  const configured = !!status.enabled;
  const enabled = configured
    && readiness.ready
    && readiness.provider === status.provider;
  const accountAuthorized = authenticated
    && hasProductionAIAccess(req.user, req.app?.locals?.runtimeConfig);
  const authorized = enabled && accountAuthorized;
  let reason = null;
  if (!configured) reason = 'provider_not_configured';
  else if (readiness.state === 'not_started' || readiness.state === 'checking') reason = 'provider_validation_pending';
  else if (!enabled) reason = 'provider_validation_failed';
  else if (!authenticated) reason = 'authentication_required';
  else if (!accountAuthorized) reason = 'account_verification_required';

  const messages = {
    provider_not_configured: 'Ember AI is not configured on the server.',
    provider_validation_pending: 'Ember AI is validating the managed provider.',
    provider_validation_failed: 'Ember AI is temporarily unavailable.',
    authentication_required: 'Sign in to use Ember AI.',
    account_verification_required: 'Verify your Ember account before using managed AI.'
  };
  return {
    managed: true,
    enabled,
    provider: enabled ? status.provider : null,
    model: enabled ? (readiness.model || status.model) : null,
    requiresAuthentication: true,
    authenticated,
    authorized,
    readiness: { ready: enabled, state: readiness.state, checkedAt: readiness.checkedAt },
    message: reason ? messages[reason] : 'Ember AI is ready.',
    ...(reason ? { reason } : {})
  };
}

function rejectClientCredentials(req, res, next) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return next();
  const forbidden = FORBIDDEN_CLIENT_FIELDS.find((field) => Object.hasOwn(body, field));
  if (forbidden) {
    return res.status(400).json({
      error: 'Provider selection and credentials are managed by Ember.',
      code: 'CLIENT_AI_CREDENTIALS_NOT_ACCEPTED'
    });
  }
  next();
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function maxRateEntries() {
  return positiveInteger(process.env.EMBER_AI_RATE_LIMIT_MAX_ENTRIES, DEFAULT_MAX_RATE_ENTRIES);
}

function pruneMap(map, current, targetSize) {
  for (const [key, window] of map) {
    if (current - window.startedAt >= RATE_WINDOW_MS) map.delete(key);
  }
  if (map.size > targetSize) {
    const excess = map.size - targetSize;
    const oldest = [...map.entries()]
      .sort((a, b) => a[1].startedAt - b[1].startedAt)
      .slice(0, excess);
    for (const [key] of oldest) map.delete(key);
  }
}

function cleanupRateWindows(current = Date.now(), force = false) {
  const maxEntries = maxRateEntries();
  const atCapacity = rateWindows.size >= maxEntries || ipRateWindows.size >= maxEntries;
  if (!force && !atCapacity && current - lastRateCleanupAt < RATE_WINDOW_MS) return;
  // Leave room for the request currently entering each map.
  const targetSize = Math.max(0, maxEntries - 1);
  pruneMap(rateWindows, current, targetSize);
  pruneMap(ipRateWindows, current, targetSize);
  lastRateCleanupAt = current;
}

function consumeFixedWindow(map, key, limit, current) {
  let window = map.get(key);
  if (!window || current - window.startedAt >= RATE_WINDOW_MS) {
    window = { startedAt: current, count: 0 };
    map.set(key, window);
  }
  if (window.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((RATE_WINDOW_MS - (current - window.startedAt)) / 1000))
    };
  }
  window.count += 1;
  return { allowed: true, remaining: Math.max(0, limit - window.count), retryAfter: 0 };
}

function clientIpKey(req) {
  // Do not trust X-Forwarded-For unless Express is explicitly configured to
  // trust a proxy. The raw address is HMACed with an ephemeral process salt so
  // the limiter never retains or logs a client IP address.
  const address = req.app?.get('trust proxy')
    ? req.ip
    : (req.socket?.remoteAddress || req.ip || 'unknown');
  return createHmac('sha256', ipHashSalt).update(address).digest('base64url');
}

function ipRateLimit(req, res, next) {
  const current = Date.now();
  cleanupRateWindows(current);
  const limit = positiveInteger(process.env.EMBER_AI_IP_RATE_LIMIT_PER_MINUTE, DEFAULT_IP_RATE_LIMIT);
  const result = consumeFixedWindow(ipRateWindows, clientIpKey(req), limit, current);
  if (!result.allowed) {
    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', '0');
    res.setHeader('Retry-After', String(result.retryAfter));
    return res.status(429).json({ error: 'Ember AI request limit reached. Try again shortly.', code: 'AI_IP_RATE_LIMITED' });
  }
  next();
}

function rateLimit(req, res, next) {
  const current = Date.now();
  const limit = positiveInteger(process.env.EMBER_AI_RATE_LIMIT_PER_MINUTE, DEFAULT_RATE_LIMIT);
  const result = consumeFixedWindow(rateWindows, req.user.id, limit, current);
  res.setHeader('RateLimit-Limit', String(limit));
  res.setHeader('RateLimit-Remaining', String(result.remaining));
  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.retryAfter));
    return res.status(429).json({ error: 'Ember AI rate limit reached. Try again shortly.', code: 'AI_RATE_LIMITED' });
  }
  next();
}

function concurrencyLimit(req, res, next) {
  const configured = Number.parseInt(process.env.EMBER_AI_CONCURRENCY_LIMIT ?? '', 10);
  const limit = Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_CONCURRENCY_LIMIT;
  const key = req.user.id;
  const active = activeRequests.get(key) ?? 0;
  if (active >= limit) {
    res.setHeader('Retry-After', '1');
    return res.status(429).json({
      error: 'Another Ember AI request is already running. Try again shortly.',
      code: 'AI_CONCURRENCY_LIMITED'
    });
  }

  activeRequests.set(key, active + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const remaining = (activeRequests.get(key) ?? 1) - 1;
    if (remaining > 0) activeRequests.set(key, remaining);
    else activeRequests.delete(key);
  };
  res.once('finish', release);
  res.once('close', release);
  next();
}

function providerGuard(req, res, next) {
  const status = managedStatus(req);
  if (!status.enabled) {
    const codes = {
      invalid_server_configuration: 'AI_SERVER_MISCONFIGURED',
      provider_not_configured: 'AI_PROVIDER_NOT_CONFIGURED',
      provider_validation_pending: 'AI_PROVIDER_VALIDATION_PENDING',
      provider_validation_failed: 'AI_PROVIDER_UNAVAILABLE'
    };
    return res.status(503).json({
      error: status.message,
      code: codes[status.reason] || 'AI_PROVIDER_UNAVAILABLE',
      managed: true
    });
  }
  req.aiPreference = serverPreference(req.app?.locals?.runtimeConfig).preferred;
  next();
}

function requestAbortSignal(req, res) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once('aborted', abort);
  res.once('close', () => {
    if (!res.writableEnded) abort();
  });
  return controller.signal;
}

function boundedString(value, maxLength) {
  return value === undefined || value === null || (typeof value === 'string' && value.length <= maxLength);
}

function validReport(report) {
  const project = report?.project;
  const metrics = report?.metrics;
  return !!(
    report && typeof report === 'object' && !Array.isArray(report)
    && project && typeof project === 'object' && !Array.isArray(project)
    && boundedString(project.name, 200) && boundedString(project.engine, 100)
    && metrics && typeof metrics === 'object' && !Array.isArray(metrics)
    && metrics.severityBreakdown && typeof metrics.severityBreakdown === 'object'
    && boundedString(metrics.crashRisk, 100)
    && boundedString(metrics.buildHealth, 100)
    && boundedString(metrics.regressionRisk, 100)
    && Array.isArray(report.bugs)
    && report.bugs.length <= 500
    && report.bugs.every(validBug)
    && (!report.blockers || (
      Array.isArray(report.blockers)
      && report.blockers.length <= 50
      && report.blockers.every((blocker) => blocker && typeof blocker === 'object' && boundedString(blocker.message, 1_000))
    ))
  );
}

function validBug(bug) {
  return !!(
    bug && typeof bug === 'object' && !Array.isArray(bug)
    && typeof bug.title === 'string' && bug.title.trim() && bug.title.length <= 300
    && typeof bug.severity === 'string' && bug.severity.length <= 30
    && typeof bug.category === 'string' && bug.category.length <= 100
    && typeof bug.source === 'string' && bug.source.length <= 100
    && boundedString(bug.evidence, 12_000)
    && boundedString(bug.regressionRisk, 100)
    && boundedString(bug.reproducibilityConfidence, 100)
    && (!bug.filesInvolved || (
      Array.isArray(bug.filesInvolved)
      && bug.filesInvolved.length <= 50
      && bug.filesInvolved.every((file) => typeof file === 'string' && file.length <= 500)
    ))
    && (!bug.stepsToReproduce || (
      Array.isArray(bug.stepsToReproduce)
      && bug.stepsToReproduce.length <= 50
      && bug.stepsToReproduce.every((step) => typeof step === 'string' && step.length <= 2_000)
    ))
  );
}

function safeFailure(result) {
  return {
    ok: false,
    managed: true,
    error: result?.cancelled ? 'Ember AI request cancelled.' : 'Ember AI could not complete this request.',
    code: result?.cancelled ? 'AI_CANCELLED' : (result?.timedOut ? 'AI_TIMED_OUT' : 'AI_PROVIDER_ERROR'),
    provider: result?.provider ?? null,
    model: result?.model ?? null,
    requestId: result?.requestId ?? null
  };
}

function safeSuccess(result, durationMs) {
  const secrets = [process.env.OPENAI_API_KEY, process.env.ANTHROPIC_API_KEY];
  const provenance = {
    ok: true,
    managed: true,
    provider: result.provider,
    model: result.model,
    requestId: result.requestId ?? null,
    durationMs
  };
  if (typeof result.text === 'string') {
    return { ...provenance, text: maskSecrets(result.text, secrets) };
  }
  return {
    ...provenance,
    insufficientInfo: !!result.insufficientInfo,
    insufficientReason: result.insufficientReason ? maskSecrets(String(result.insufficientReason), secrets) : null,
    rootCause: result.rootCause ? maskSecrets(String(result.rootCause), secrets) : null,
    fix: result.fix ? maskSecrets(String(result.fix), secrets) : null,
    reproSteps: Array.isArray(result.reproSteps)
      ? result.reproSteps.slice(0, 50).map((step) => maskSecrets(String(step), secrets))
      : [],
    priorityScore: typeof result.priorityScore === 'number' ? result.priorityScore : null,
    priorityLabel: result.priorityLabel ? maskSecrets(String(result.priorityLabel), secrets) : null,
    devMessage: result.devMessage ? maskSecrets(String(result.devMessage), secrets) : null
  };
}

async function runSummary(report, req, signal) {
  return withProviderOperation(req, 'summary', signal, async () => {
    const startedAt = Date.now();
    const result = await summarizeReport(report, { provider: req.aiPreference, signal });
    return result.ok ? safeSuccess(result, Date.now() - startedAt) : safeFailure(result);
  });
}

async function runTriage(bug, req, signal) {
  return withProviderOperation(req, 'triage', signal, async () => {
    const startedAt = Date.now();
    const result = await triageBug(bug, { provider: req.aiPreference, signal });
    return result.ok ? safeSuccess(result, Date.now() - startedAt) : safeFailure(result);
  });
}

function sendProviderResult(res, result) {
  if (result.ok) return res.json(result);
  if (result.code === 'AI_CANCELLED') {
    if (!res.destroyed && !res.headersSent) return res.status(499).json(result);
    return;
  }
  return res.status(503).json(result);
}

aiRouter.get('/status', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(managedStatus(req));
});

aiRouter.use(
  requireAuth,
  requireProductionAIAccess,
  rejectClientCredentials,
  ipRateLimit,
  rateLimit,
  providerGuard,
  concurrencyLimit
);

aiRouter.post('/summary', async (req, res, next) => {
  const { report } = req.body ?? {};
  if (!validReport(report)) {
    return res.status(400).json({ error: 'A complete report payload is required.', code: 'INVALID_AI_REPORT' });
  }
  const signal = requestAbortSignal(req, res);
  try {
    return sendProviderResult(res, await runSummary(report, req, signal));
  } catch (error) {
    if (signal.aborted) return;
    next(error);
  }
});

aiRouter.post('/triage', async (req, res, next) => {
  const { bug } = req.body ?? {};
  if (!validBug(bug)) {
    return res.status(400).json({ error: 'A complete bug payload is required.', code: 'INVALID_AI_BUG' });
  }
  const signal = requestAbortSignal(req, res);
  try {
    return sendProviderResult(res, await runTriage(bug, req, signal));
  } catch (error) {
    if (signal.aborted) return;
    next(error);
  }
});

aiRouter.post('/analyze', async (req, res, next) => {
  const { report, maxBugs = MAX_TRIAGE_BUGS } = req.body ?? {};
  if (!validReport(report)) {
    return res.status(400).json({ error: 'A complete report payload is required.', code: 'INVALID_AI_REPORT' });
  }
  if (!Number.isInteger(maxBugs) || maxBugs < 0 || maxBugs > MAX_TRIAGE_BUGS) {
    return res.status(400).json({ error: `maxBugs must be an integer from 0 to ${MAX_TRIAGE_BUGS}.`, code: 'INVALID_AI_MAX_BUGS' });
  }

  const signal = requestAbortSignal(req, res);
  const startedAt = Date.now();
  try {
    const summary = await runSummary(report, req, signal);
    if (signal.aborted) return;

    const selected = report.bugs
      .filter(validBug)
      .map((bug, index) => ({ bug, index }))
      .sort((a, b) => (SEVERITY_RANK[a.bug.severity] ?? 4) - (SEVERITY_RANK[b.bug.severity] ?? 4) || a.index - b.index)
      .slice(0, maxBugs);
    const triage = [];
    for (const { bug, index } of selected) {
      if (signal.aborted) return;
      triage.push({ bugId: bug.id ?? `bug-${index + 1}`, ...(await runTriage(bug, req, signal)) });
    }

    const ok = summary.ok || triage.some((item) => item.ok);
    return res.status(ok ? 200 : 503).json({
      ok,
      managed: true,
      summary,
      triage,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    if (signal.aborted) return;
    next(error);
  }
});

aiRouter.use((error, _req, res, next) => {
  if (!(error instanceof AICostLimitError)) return next(error);
  res.setHeader('Retry-After', String(error.retryAfter));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(error.statusCode).json({
    error: error.message,
    code: error.code,
    managed: true
  });
});

/** Test-only reset so isolated app tests cannot inherit a previous quota. */
export function resetAIRateLimits() {
  rateWindows.clear();
  ipRateWindows.clear();
  activeRequests.clear();
  lastRateCleanupAt = 0;
  resetAICostRuntimeState();
}

/** Test-only visibility for deterministic cleanup/capacity assertions. */
export function aiRateLimitStats() {
  return { users: rateWindows.size, ips: ipRateWindows.size, active: activeRequests.size };
}

/** Uses the production cleanup path with a test-supplied clock. */
export function cleanupAIRateLimitsForTest(current) {
  cleanupRateWindows(current, true);
}
