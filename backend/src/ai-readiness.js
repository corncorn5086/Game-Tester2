import { aiStatus, testAIConnection } from '@ember/agent';

const PROVIDERS = new Set(['auto', 'openai', 'claude']);
const READINESS_TIMEOUT_MS = 20_000;

let generation = 0;
let readiness = initialReadiness();
let readinessPromise = null;

function initialReadiness() {
  return Object.freeze({
    ready: false,
    state: 'not_started',
    provider: null,
    model: null,
    checkedAt: null
  });
}

function snapshot() {
  return { ...readiness };
}

function finish(state, { provider = null, model = null } = {}) {
  readiness = Object.freeze({
    ready: state === 'ready',
    state,
    provider: state === 'ready' ? provider : null,
    model: state === 'ready' ? model : null,
    checkedAt: new Date().toISOString()
  });
  return snapshot();
}

/**
 * Run the provider smoke test once for this process. The settled promise and a
 * tiny, sanitized state object are retained; provider errors and responses are
 * deliberately discarded. There is no retry timer, and health/status reads
 * never trigger another paid request.
 */
export function startAIReadinessCheck({
  provider = 'auto',
  production = false,
  checkConnection = testAIConnection
} = {}) {
  if (readinessPromise) return readinessPromise;

  const normalized = String(provider ?? 'auto').trim().toLowerCase() || 'auto';
  if (!PROVIDERS.has(normalized) || (production && normalized === 'auto')) {
    readinessPromise = Promise.resolve(finish('misconfigured'));
    return readinessPromise;
  }

  const preferred = normalized === 'auto' ? undefined : normalized;
  const configured = aiStatus(preferred);
  if (!configured.enabled || (preferred && configured.provider !== preferred)) {
    readinessPromise = Promise.resolve(finish('unconfigured'));
    return readinessPromise;
  }

  const selectedProvider = configured.provider;
  const selectedModel = configured.model;
  const currentGeneration = generation;
  readiness = Object.freeze({
    ready: false,
    state: 'checking',
    provider: null,
    model: null,
    checkedAt: null
  });

  readinessPromise = (async () => {
    let result;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), READINESS_TIMEOUT_MS);
    timeout.unref?.();
    try {
      result = await checkConnection({ provider: selectedProvider, signal: controller.signal });
    } catch {
      result = null;
    } finally {
      clearTimeout(timeout);
    }

    // Tests can reset state while an injected probe is pending. Never let an
    // obsolete completion overwrite the newer generation.
    if (currentGeneration !== generation) return snapshot();

    if (
      result?.ok === true
      && result.provider === selectedProvider
      && typeof result.text === 'string'
      && result.text.trim() === 'EMBER_OK'
    ) {
      return finish('ready', {
        provider: selectedProvider,
        model: result.model || selectedModel
      });
    }
    return finish('failed');
  })();

  return readinessPromise;
}

/** Sanitized, side-effect-free readiness state for health and API responses. */
export function aiReadinessSnapshot() {
  return snapshot();
}

/** Test-only process state reset. Production code never retries automatically. */
export function resetAIReadinessForTest() {
  generation += 1;
  readiness = initialReadiness();
  readinessPromise = null;
}
