import { isAbsolute, resolve } from 'node:path';
import { isIP } from 'node:net';
import { DEFAULT_BACKEND_URL } from '@ember/shared/constants';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const TRUST_PROXY_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);
const RAILWAY_RUNTIME_SIGNALS = [
  'RAILWAY_PUBLIC_DOMAIN',
  'RAILWAY_PRIVATE_DOMAIN',
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_ENVIRONMENT_ID',
  'RAILWAY_PROJECT_ID',
  'RAILWAY_SERVICE_ID',
  'RAILWAY_DEPLOYMENT_ID',
  'RAILWAY_REPLICA_ID',
  'RAILWAY_VOLUME_MOUNT_PATH',
  'RAILWAY_STATIC_URL'
];

export class StartupConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StartupConfigError';
    this.code = code;
  }
}

export function loadRuntimeConfig(env = process.env) {
  const production = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  requireProductionForPublicRuntime(env, { production });
  const apiUrl = publicUrl('API_URL', env.API_URL, { production, required: production });
  const trustProxy = parseTrustProxy(env.EMBER_TRUST_PROXY, { production });
  const corsOrigins = parseCorsOrigins(env.EMBER_CORS_ORIGINS, { production });
  const dataDir = configuredDataDirectory(env, { production });
  const provider = validateManagedAI(env, { production });
  const apiMode = validatedApiMode(env.EMBER_API_MODE, { production });

  if (production && trustProxy === false) {
    throw new StartupConfigError(
      'TRUST_PROXY_REQUIRED',
      'EMBER_TRUST_PROXY must identify the verified production proxy using trusted ranges, CIDRs, or a validated hop count.'
    );
  }

  return Object.freeze({
    production,
    host: validatedHost(env.HOST, production ? '0.0.0.0' : '127.0.0.1'),
    port: configuredPort(env.PORT, apiUrl),
    apiUrl,
    dataDir,
    trustProxy,
    corsOrigins: Object.freeze(corsOrigins),
    aiProvider: provider,
    apiMode,
    publicSignup: production
      ? String(env.EMBER_PUBLIC_SIGNUP ?? '').trim().toLowerCase() === 'true'
      : String(env.EMBER_PUBLIC_SIGNUP ?? '').trim().toLowerCase() !== 'false',
    shutdownTimeoutMs: boundedInteger(env.EMBER_SHUTDOWN_TIMEOUT_MS, 15_000, 1_000, 120_000, 'EMBER_SHUTDOWN_TIMEOUT_MS')
  });
}

function requireProductionForPublicRuntime(env, { production }) {
  if (production) return;
  const signals = [];
  const host = String(env.HOST ?? '').trim();
  if (host && !isLoopbackHostname(host)) signals.push('HOST');

  const apiUrl = String(env.API_URL ?? '').trim();
  if (apiUrl) {
    try {
      const parsed = new URL(apiUrl);
      if (['http:', 'https:'].includes(parsed.protocol) && !isLoopbackHostname(parsed.hostname)) {
        signals.push('API_URL');
      }
    } catch {
      // publicUrl() below owns malformed-URL diagnostics.
    }
  }

  for (const name of RAILWAY_RUNTIME_SIGNALS) {
    if (String(env[name] ?? '').trim()) signals.push(name);
  }
  if (!signals.length) return;

  throw new StartupConfigError(
    'PUBLIC_RUNTIME_REQUIRES_PRODUCTION',
    `NODE_ENV=production is required when the backend has public-runtime signals (${[...new Set(signals)].join(', ')}).`
  );
}

function isLoopbackHostname(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '::1') return true;
  return /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function validatedApiMode(value, { production }) {
  const configured = String(value ?? '').trim().toLowerCase();
  if (!configured) {
    if (production) {
      throw new StartupConfigError(
        'API_MODE_REQUIRED',
        'EMBER_API_MODE=managed-ai is required for the public production backend.'
      );
    }
    return 'full';
  }
  if (!['full', 'managed-ai'].includes(configured)) {
    throw new StartupConfigError('API_MODE_INVALID', 'EMBER_API_MODE must be full or managed-ai.');
  }
  if (production && configured !== 'managed-ai') {
    throw new StartupConfigError(
      'API_MODE_UNSAFE',
      'The legacy full API is not approved for public production. Use EMBER_API_MODE=managed-ai.'
    );
  }
  return configured;
}

export function parseTrustProxy(value, { production = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text || /^(?:false|0|off|no)$/i.test(text)) return false;
  if (/^(?:true|\*)$/i.test(text)) {
    if (production) {
      throw new StartupConfigError(
        'TRUST_PROXY_TOO_BROAD',
        'Production must not trust every proxy. Use a hop count or explicit proxy CIDR ranges.'
      );
    }
    return true;
  }
  if (/^\d+$/.test(text)) {
    const hops = Number(text);
    if (hops >= 1 && hops <= 100) return hops;
    throw new StartupConfigError('TRUST_PROXY_INVALID', 'EMBER_TRUST_PROXY hop count must be between 1 and 100.');
  }

  const entries = text.split(',').map((item) => item.trim()).filter(Boolean);
  if (!entries.length || entries.some((entry) => !validProxyRange(entry))) {
    throw new StartupConfigError(
      'TRUST_PROXY_INVALID',
      'EMBER_TRUST_PROXY must be a hop count, loopback/linklocal/uniquelocal, or comma-separated IP/CIDR ranges.'
    );
  }
  return entries.join(', ');
}

export function parseCorsOrigins(value, { production = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return production ? [] : ['*'];
  const entries = [...new Set(text.split(',').map((item) => item.trim()).filter(Boolean))];
  if (entries.includes('*')) {
    if (production) {
      throw new StartupConfigError('CORS_WILDCARD_FORBIDDEN', 'EMBER_CORS_ORIGINS cannot contain * in production.');
    }
    if (entries.length !== 1) {
      throw new StartupConfigError('CORS_ORIGIN_INVALID', 'The CORS wildcard cannot be combined with explicit origins.');
    }
    return ['*'];
  }
  return entries.map((entry) => normalizeOrigin(entry, { production }));
}

export function configuredDataDirectory(env = process.env, { production = false } = {}) {
  const configured = String(env.EMBER_DATA_DIR ?? '').trim();
  if (production && !configured) {
    throw new StartupConfigError(
      'PERSISTENT_DATA_DIR_REQUIRED',
      'EMBER_DATA_DIR must point to a persistent mounted directory in production.'
    );
  }
  if (!configured) return null;
  if (configured.includes('\0')) throw new StartupConfigError('DATA_DIR_INVALID', 'EMBER_DATA_DIR contains an invalid character.');
  const absolute = resolve(configured);
  if (production && !isAbsolute(configured)) {
    throw new StartupConfigError('DATA_DIR_NOT_ABSOLUTE', 'EMBER_DATA_DIR must be an absolute path in production.');
  }
  return absolute;
}

function publicUrl(name, value, { production, required }) {
  const text = String(value ?? '').trim();
  if (!text) {
    if (required) throw new StartupConfigError('PUBLIC_HTTPS_URL_REQUIRED', `${name} must be the public HTTPS backend URL in production.`);
    return null;
  }
  let parsed;
  try { parsed = new URL(text); }
  catch { throw new StartupConfigError('PUBLIC_URL_INVALID', `${name} must be a valid HTTP(S) URL.`); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new StartupConfigError('PUBLIC_URL_INVALID', `${name} must be an HTTP(S) URL without embedded credentials, query, or fragment.`);
  }
  if (production && parsed.protocol !== 'https:') {
    throw new StartupConfigError('PUBLIC_HTTPS_REQUIRED', `${name} must use HTTPS in production.`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function validateManagedAI(env, { production }) {
  const provider = String(env.EMBER_AI_PROVIDER ?? 'auto').trim().toLowerCase() || 'auto';
  if (!['auto', 'openai', 'claude'].includes(provider)) {
    throw new StartupConfigError('AI_PROVIDER_INVALID', 'EMBER_AI_PROVIDER must be auto, openai, or claude.');
  }
  if (production && provider === 'auto') {
    throw new StartupConfigError(
      'AI_PROVIDER_EXPLICIT_REQUIRED',
      'Production must set EMBER_AI_PROVIDER=openai or claude so each logical request has one billable provider.'
    );
  }
  if (production && provider === 'openai' && !String(env.OPENAI_API_KEY ?? '').trim()) {
    throw new StartupConfigError('AI_PROVIDER_KEY_REQUIRED', 'OPENAI_API_KEY is required when EMBER_AI_PROVIDER=openai in production.');
  }
  if (production && provider === 'claude' && !String(env.ANTHROPIC_API_KEY ?? '').trim()) {
    throw new StartupConfigError('AI_PROVIDER_KEY_REQUIRED', 'ANTHROPIC_API_KEY is required when EMBER_AI_PROVIDER=claude in production.');
  }
  return provider;
}

function normalizeOrigin(value, { production }) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new StartupConfigError('CORS_ORIGIN_INVALID', `Invalid CORS origin: ${value}`); }
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || parsed.origin === 'null'
  ) {
    throw new StartupConfigError('CORS_ORIGIN_INVALID', 'CORS entries must be exact HTTP(S) origins without paths or credentials.');
  }
  if (production && parsed.protocol !== 'https:' && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new StartupConfigError('CORS_HTTPS_REQUIRED', 'Remote production CORS origins must use HTTPS.');
  }
  return parsed.origin;
}

function validProxyRange(value) {
  if (TRUST_PROXY_NAMES.has(value.toLowerCase())) return true;
  const slash = value.lastIndexOf('/');
  const address = slash === -1 ? value : value.slice(0, slash);
  const prefix = slash === -1 ? null : value.slice(slash + 1);
  const family = isIP(address);
  if (!family || (prefix !== null && !/^\d{1,3}$/.test(prefix))) return false;
  if (prefix === null) return true;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

function configuredPort(value, apiUrl) {
  if (value != null && String(value).trim()) return boundedInteger(value, 4310, 1, 65_535, 'PORT');
  if (apiUrl) {
    const parsed = new URL(apiUrl);
    if (parsed.port) return Number(parsed.port);
  }
  try {
    const fallback = new URL(DEFAULT_BACKEND_URL);
    return fallback.port ? Number(fallback.port) : 4310;
  } catch {
    return 4310;
  }
}

function boundedInteger(value, fallback, min, max, name) {
  if (value == null || String(value).trim() === '') return fallback;
  if (!/^\d+$/.test(String(value).trim())) {
    throw new StartupConfigError('SERVER_NUMBER_INVALID', `${name} must be an integer between ${min} and ${max}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new StartupConfigError('SERVER_NUMBER_INVALID', `${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function validatedHost(value, fallback) {
  const host = String(value ?? '').trim() || fallback;
  if (host.length > 255 || !/^[A-Za-z0-9:._-]+$/.test(host)) {
    throw new StartupConfigError('HOST_INVALID', 'HOST must be a hostname or IP address without a URL scheme.');
  }
  return host;
}
