const { unlink } = require('node:fs/promises');
const { join } = require('node:path');
const { DesktopBridgeError } = require('./project-service.cjs');

const DEFAULT_MANAGED_AI_URL = 'http://localhost:4310';
// /ai/analyze can run one 60s summary plus three 60s triages sequentially.
const DEFAULT_TIMEOUT_MS = 260_000;
// The server accepts 512 KiB. Leave headroom and reject locally before any
// oversized report content leaves the machine.
const MAX_OUTBOUND_BYTES = 480 * 1024;
const PROVIDER_SECRET_ENV = /(?:OPENAI|ANTHROPIC|CLAUDE).*(?:(?:API[_-]?)?KEY|TOKEN|SECRET)|(?:(?:API[_-]?)?KEY|TOKEN|SECRET).*(?:OPENAI|ANTHROPIC|CLAUDE)/i;

/** Remove provider-owned credentials before any Desktop subsystem can read them. */
function stripProviderSecretsFromEnvironment(environment = process.env) {
  let removed = 0;
  for (const name of Object.keys(environment || {})) {
    if (!PROVIDER_SECRET_ENV.test(name)) continue;
    try { delete environment[name]; } catch { environment[name] = ''; }
    removed++;
  }
  return removed;
}

/**
 * Remove the one exact file used by an older build for provider credentials.
 * Its content is intentionally never opened, parsed or logged.
 */
async function removeLegacyAICredentialFile(dataDir, unlinkFile = unlink) {
  if (typeof dataDir !== 'string' || !dataDir) throw new TypeError('dataDir is required');
  try {
    await unlinkFile(join(dataDir, 'ai-credentials.v1.json'));
    return { removed: true };
  } catch (error) {
    if (error?.code === 'ENOENT') return { removed: false };
    throw new DesktopBridgeError(
      'AI_LEGACY_CREDENTIAL_CLEANUP_FAILED',
      'Ember n’a pas pu supprimer un ancien fichier local d’identifiants IA.'
    );
  }
}

function createManagedAIClient({
  defaultBaseUrl = DEFAULT_MANAGED_AI_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const safeDefaultUrl = normalizeBaseUrl(defaultBaseUrl);

  async function getStatus({ config = null, sessionToken = null, signal } = {}) {
    const startedAt = Date.now();
    try {
      const connection = connectionFromConfig(config, safeDefaultUrl, sessionToken, false);
      const response = await request(fetchImpl, connection, '/ai/status', {
        method: 'GET',
        signal,
        timeoutMs
      });
      const payload = await responsePayload(response);
      if (!response.ok) throw httpError(response.status, payload);
      if (payload?.managed !== true) {
        throw new DesktopBridgeError('AI_MANAGED_RESPONSE_INVALID', 'Le service IA n’a pas confirmé son mode géré.');
      }
      const enabled = payload.enabled === true;
      const requiresAuthentication = payload.requiresAuthentication !== false;
      const authenticated = payload.authenticated === true;
      // New production backends can deny an authenticated but unverified
      // account. Respect that explicit server decision; keep compatibility
      // with older development backends that did not return `authorized`.
      const authorized = enabled
        && (!requiresAuthentication || authenticated)
        && payload.authorized !== false;
      const reason = cleanReason(payload.reason);
      return {
        managed: true,
        enabled,
        configured: enabled,
        authorized,
        available: authorized,
        status: !enabled
          ? 'disabled'
          : requiresAuthentication && !authenticated
            ? 'authentication-required'
            : !authorized && reason === 'account_verification_required'
              ? 'verification-required'
              : !authorized
                ? 'unauthorized'
                : 'authorized',
        provider: cleanProvider(payload.provider),
        model: cleanText(payload.model, 160),
        requiresAuthentication,
        authenticated,
        message: cleanText(payload.message, 1_000) || (enabled ? 'Service IA géré disponible.' : 'Service IA géré désactivé.'),
        reason,
        durationMs: Date.now() - startedAt
      };
    } catch (error) {
      if (signal?.aborted || error?.code === 'AI_CANCELLED') throw error;
      return {
        managed: true,
        enabled: false,
        available: false,
        configured: false,
        authorized: false,
        status: 'offline',
        provider: null,
        model: null,
        requiresAuthentication: true,
        authenticated: false,
        message: 'Le service IA géré est actuellement injoignable. L’analyse locale reste disponible.',
        reason: cleanReason(error?.code) || 'service-unreachable',
        durationMs: Date.now() - startedAt
      };
    }
  }

  async function analyze(report, { config = null, sessionToken = null, maxBugs = 3, signal } = {}) {
    if (!isRecord(report)) {
      throw new DesktopBridgeError('AI_REPORT_INVALID', 'Le rapport local à analyser est invalide.');
    }
    const connection = connectionFromConfig(config, safeDefaultUrl, sessionToken, true);
    const bugLimit = Number.isInteger(maxBugs) ? Math.max(0, Math.min(3, maxBugs)) : 3;
    const body = JSON.stringify({ report: managedReportPayload(report), maxBugs: bugLimit });
    if (Buffer.byteLength(body, 'utf8') > MAX_OUTBOUND_BYTES) {
      throw new DesktopBridgeError(
        'AI_PAYLOAD_TOO_LARGE',
        'Le rapport est trop volumineux pour l’analyse IA gérée. Le rapport local sera conservé.'
      );
    }

    const startedAt = Date.now();
    let response;
    try {
      response = await request(fetchImpl, connection, '/ai/analyze', {
        method: 'POST',
        body,
        signal,
        timeoutMs
      });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') {
        throw new DesktopBridgeError('AI_CANCELLED', 'L’analyse IA gérée a été annulée.', { cancelled: true }, error);
      }
      if (error instanceof DesktopBridgeError) throw error;
      throw new DesktopBridgeError(
        'AI_SERVICE_UNREACHABLE',
        'Le service IA géré est injoignable. Le rapport local sera conservé.',
        null,
        error
      );
    }

    const payload = await responsePayload(response);
    if (!response.ok) throw httpError(response.status, payload);
    if (payload?.ok !== true || payload?.managed !== true) {
      throw new DesktopBridgeError('AI_MANAGED_RESPONSE_INVALID', 'Le service IA géré a retourné une réponse invalide.');
    }
    return normalizeAnalysis(payload, Date.now() - startedAt);
  }

  return { analyze, getStatus };
}

async function request(fetchImpl, connection, path, { method, body, signal, timeoutMs }) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (connection.token) headers.authorization = `Bearer ${connection.token}`;
  try {
    return await fetchImpl(`${connection.baseUrl}${path}`, {
      method,
      headers,
      body,
      redirect: 'error',
      signal: combinedSignal(signal, timeoutMs)
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new DesktopBridgeError('AI_CANCELLED', 'L’analyse IA gérée a été annulée.', { cancelled: true }, error);
    }
    if (error?.name === 'TimeoutError') {
      throw new DesktopBridgeError('AI_SERVICE_TIMEOUT', 'Le service IA géré n’a pas répondu à temps.', null, error);
    }
    throw error;
  }
}

function connectionFromConfig(config, defaultBaseUrl, sessionToken, requireToken) {
  const baseUrl = normalizeBaseUrl(config?.backend?.url || defaultBaseUrl);
  // Desktop sessions come only from the encrypted main-process auth store.
  // config.backend.token remains a CLI feature and is deliberately ignored.
  const rawToken = sessionToken;
  const token = typeof rawToken === 'string' && rawToken.trim() ? rawToken.trim() : null;
  if (token && (token.length > 4_096 || /[\u0000-\u001f\u007f]/.test(token))) {
    throw new DesktopBridgeError('AI_AUTH_INVALID', 'Le jeton de session Ember configuré est invalide.');
  }
  if (requireToken && !token) {
    throw new DesktopBridgeError('AI_AUTH_REQUIRED', 'Connectez Ember au service géré avant d’activer l’analyse IA.');
  }
  return { baseUrl, token };
}

function normalizeBaseUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || DEFAULT_MANAGED_AI_URL)); }
  catch { throw new DesktopBridgeError('AI_SERVICE_URL_INVALID', 'L’adresse du service Ember géré est invalide.'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new DesktopBridgeError(
      'AI_SERVICE_URL_INVALID',
      'L’adresse du service Ember géré doit être une URL HTTP(S) sans identifiants intégrés.'
    );
  }
  if (parsed.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)) {
    throw new DesktopBridgeError('AI_SERVICE_URL_INSECURE', 'Le service Ember distant doit utiliser HTTPS.');
  }
  return parsed.toString().replace(/\/$/, '');
}

function combinedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(Math.max(1_000, timeoutMs || DEFAULT_TIMEOUT_MS));
  if (!signal) return timeout;
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal;
}

async function responsePayload(response) {
  try { return await response?.json?.(); }
  catch { return null; }
}

function httpError(status, payload) {
  const serverMessage = cleanText(payload?.error || payload?.message, 1_000);
  if (status === 403 && payload?.code === 'AI_ACCOUNT_VERIFICATION_REQUIRED') {
    return new DesktopBridgeError(
      'AI_ACCOUNT_VERIFICATION_REQUIRED',
      serverMessage || 'Vérifiez votre compte Ember avant d’utiliser l’analyse IA gérée.',
      { status, reason: 'account_verification_required' }
    );
  }
  if (status === 401 || status === 403) {
    return new DesktopBridgeError(
      'AI_AUTH_REQUIRED',
      'La session Ember n’autorise pas l’analyse IA gérée. Reconnectez-vous.',
      { status }
    );
  }
  if (status === 413) {
    return new DesktopBridgeError('AI_PAYLOAD_TOO_LARGE', 'Le rapport est trop volumineux pour l’analyse IA gérée.', { status });
  }
  if (status === 400) {
    return new DesktopBridgeError('AI_REQUEST_INVALID', serverMessage || 'La demande d’analyse IA est invalide.', { status });
  }
  if (status === 503) {
    return new DesktopBridgeError(
      'AI_MANAGED_UNAVAILABLE',
      serverMessage || 'Le service IA géré est temporairement indisponible.',
      { status }
    );
  }
  return new DesktopBridgeError('AI_SERVICE_ERROR', 'Le service IA géré n’a pas pu terminer la demande.', { status });
}

function normalizeAnalysis(payload, roundTripDurationMs) {
  const summary = isRecord(payload.summary)
    ? {
        ok: payload.summary.ok === true,
        text: cleanText(payload.summary.text, 12_000),
        provider: cleanProvider(payload.summary.provider),
        model: cleanText(payload.summary.model, 160),
        requestId: cleanRequestId(payload.summary.requestId),
        durationMs: positiveDuration(payload.summary.durationMs)
      }
    : null;
  const triage = (Array.isArray(payload.triage) ? payload.triage : []).slice(0, 3).map((item) => ({
    bugId: cleanId(item?.bugId),
    ok: item?.ok === true,
    provider: cleanProvider(item?.provider),
    model: cleanText(item?.model, 160),
    requestId: cleanRequestId(item?.requestId),
    durationMs: positiveDuration(item?.durationMs),
    insufficientInfo: item?.insufficientInfo === true,
    insufficientReason: cleanText(item?.insufficientReason, 12_000),
    rootCause: cleanText(item?.rootCause, 12_000),
    fix: cleanText(item?.fix, 12_000),
    reproSteps: (Array.isArray(item?.reproSteps) ? item.reproSteps : [])
      .slice(0, 20)
      .map((step) => cleanText(step, 2_000)),
    priorityScore: Number.isFinite(item?.priorityScore) ? Math.max(0, Math.min(100, item.priorityScore)) : null,
    priorityLabel: cleanText(item?.priorityLabel, 80),
    devMessage: cleanText(item?.devMessage, 12_000)
  })).filter((item) => item.bugId);
  return {
    ok: true,
    managed: true,
    summary,
    triage,
    durationMs: positiveDuration(payload.durationMs),
    roundTripDurationMs: positiveDuration(roundTripDurationMs)
  };
}

/**
 * Build only the report shape consumed by the managed prompts. This allow-list
 * keeps project roots, raw source, execution logs, config and future fields on
 * the device by default.
 */
function managedReportPayload(report) {
  const project = isRecord(report.project) ? report.project : {};
  const metrics = isRecord(report.metrics) ? report.metrics : {};
  const severity = isRecord(metrics.severityBreakdown) ? metrics.severityBreakdown : {};
  const projectRoot = typeof project.root === 'string' ? project.root : null;
  const selectedBugs = (Array.isArray(report.bugs) ? report.bugs : [])
    .map((bug, index) => ({ bug, index }))
    .filter(({ bug }) => isRecord(bug) && typeof bug.title === 'string' && bug.title.trim())
    .sort((a, b) => bugSeverityRank(a.bug.severity) - bugSeverityRank(b.bug.severity) || a.index - b.index)
    .slice(0, 3)
    .map(({ bug }) => managedBugPayload(bug, projectRoot));
  return {
    project: {
      name: reportText(project.name, 200, '(unknown)', projectRoot),
      engine: reportText(project.engine, 100, '(unknown)')
    },
    metrics: {
      filesScanned: reportNumber(metrics.filesScanned),
      logsAnalyzed: reportNumber(metrics.logsAnalyzed),
      bugsFound: reportNumber(metrics.bugsFound),
      crashRisk: reportText(metrics.crashRisk, 100, 'unknown'),
      buildHealth: reportText(metrics.buildHealth, 100, 'unknown'),
      regressionRisk: reportText(metrics.regressionRisk, 100, 'unknown'),
      severityBreakdown: {
        critical: reportNumber(severity.critical),
        high: reportNumber(severity.high),
        medium: reportNumber(severity.medium),
        low: reportNumber(severity.low)
      }
    },
    blockers: (Array.isArray(report.blockers) ? report.blockers : [])
      .slice(0, 50)
      .filter(isRecord)
      .map((blocker) => ({ message: reportText(blocker.message, 1_000, '', projectRoot) })),
    bugs: selectedBugs
  };
}

function managedBugPayload(bug, projectRoot) {
  const payload = {
    title: reportText(bug.title, 300, '', projectRoot),
    severity: reportText(bug.severity, 30, 'unknown'),
    category: reportText(bug.category, 100, 'unknown'),
    source: reportText(bug.source, 100, 'unknown')
  };
  optionalReportText(payload, 'id', bug.id, 160);
  optionalReportText(payload, 'evidence', bug.evidence, 12_000, projectRoot);
  optionalReportText(payload, 'regressionRisk', bug.regressionRisk, 100);
  optionalReportText(payload, 'reproducibilityConfidence', bug.reproducibilityConfidence, 100);
  if (Array.isArray(bug.filesInvolved)) {
    payload.filesInvolved = bug.filesInvolved
      .slice(0, 50)
      .filter((value) => typeof value === 'string')
      .map((value) => safeRelativeFile(value, projectRoot))
      .filter(Boolean);
  }
  if (Array.isArray(bug.stepsToReproduce)) {
    payload.stepsToReproduce = bug.stepsToReproduce
      .slice(0, 50)
      .filter((value) => typeof value === 'string')
      .map((value) => reportText(value, 2_000, '', projectRoot));
  }
  if (Number.isFinite(bug.line)) payload.line = Math.max(0, Math.floor(bug.line));
  return payload;
}

function optionalReportText(target, key, value, max, projectRoot = null) {
  if (typeof value === 'string') target[key] = reportText(value, max, '', projectRoot);
}

function reportText(value, max, fallback, projectRoot = null) {
  if (typeof value !== 'string') return fallback;
  const cleaned = scrubAbsolutePaths(value.slice(0, max + 1_024), projectRoot)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\b(?:sk-(?:proj-)?|sk-ant-)[A-Za-z0-9_-]{12,}\b/g, '***MASKED***')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***MASKED***')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1***MASKED***')
    .slice(0, max);
  return cleaned || fallback;
}

function safeRelativeFile(value, projectRoot) {
  let path = String(value || '').trim().replace(/\\/g, '/');
  if (!path || path.length > 4_096) return null;
  const root = typeof projectRoot === 'string'
    ? projectRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    : '';
  const absolute = /^(?:[A-Za-z]:\/|\/|\/\/)/.test(path);
  if (absolute) {
    const pathKey = path.toLowerCase();
    const rootKey = root.toLowerCase();
    if (!root || (pathKey !== rootKey && !pathKey.startsWith(`${rootKey}/`))) return null;
    path = path.slice(root.length).replace(/^\/+/, '');
  }
  path = path.replace(/^\.\//, '');
  if (!path || path.split('/').includes('..') || /^(?:[A-Za-z]:\/|\/|\/\/)/.test(path)) return null;
  return reportText(path, 500, '');
}

function scrubAbsolutePaths(value, projectRoot) {
  let text = String(value);
  if (typeof projectRoot === 'string' && projectRoot.trim()) {
    const roots = new Set([
      projectRoot.trim(),
      projectRoot.trim().replace(/\\/g, '/'),
      projectRoot.trim().replace(/\//g, '\\')
    ]);
    for (const root of roots) {
      text = text.replace(new RegExp(escapeRegExp(root), 'gi'), '[project]');
    }
  }
  return text
    .replace(/\bfile:\/\/\/[^\r\n"'<>;,)]*/gi, '[absolute-path]')
    .replace(/\\\\[^\\\r\n]+\\[^\r\n"'<>|;,)]*/g, '[absolute-path]')
    .replace(/\b[A-Za-z]:[\\/][^\r\n"'<>|;,)]*/g, '[absolute-path]')
    .replace(/(^|[\s("'=])\/(?!\/)[^\r\n"'<>;,)]*/g, '$1[absolute-path]');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bugSeverityRank(value) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[String(value || '').toLowerCase()] ?? 4;
}

function reportNumber(value) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanProvider(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{2,80}$/.test(value) ? value : null;
}

function cleanRequestId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{3,200}$/.test(value) ? value : null;
}

function cleanId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{3,160}$/.test(value) ? value : null;
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) || null : null;
}

function cleanReason(value) {
  return typeof value === 'string' ? value.replace(/[^a-z0-9_.-]/gi, '-').slice(0, 120) || null : null;
}

function positiveDuration(value) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  createManagedAIClient,
  managedReportPayload,
  removeLegacyAICredentialFile,
  stripProviderSecretsFromEnvironment
};
