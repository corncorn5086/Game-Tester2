const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const DEVELOPMENT_SERVICE_URL = 'http://localhost:4310';
const BUNDLED_SERVICE_CONFIG_FILENAME = 'ember-service.json';
const SERVICE_CONFIG_SCHEMA_VERSION = 1;
const ALLOWED_CONFIG_KEYS = new Set(['schemaVersion', 'serviceUrl']);

class PublicServiceConfigError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PublicServiceConfigError';
    this.code = code;
  }
}

/**
 * Resolve the single Ember service endpoint trusted by Desktop.
 *
 * Development deliberately uses the local backend. A packaged application
 * must carry the generated public resource and never consults process.env or
 * a game project's editable ember.config.json.
 */
function resolveDesktopServiceConfig({
  isPackaged,
  resourcesPath,
  readFile = readFileSync
} = {}) {
  if (isPackaged !== true) {
    return immutableServiceConfig(normalizeServiceUrl(DEVELOPMENT_SERVICE_URL, { allowLocalhost: true }));
  }
  if (typeof resourcesPath !== 'string' || !resourcesPath.trim()) {
    throw new PublicServiceConfigError(
      'EMBER_SERVICE_CONFIG_MISSING',
      'La configuration publique du service Ember est absente de cette application.'
    );
  }

  const configPath = join(resourcesPath, BUNDLED_SERVICE_CONFIG_FILENAME);
  let raw;
  try {
    raw = readFile(configPath, 'utf8');
  } catch (error) {
    throw new PublicServiceConfigError(
      'EMBER_SERVICE_CONFIG_MISSING',
      'La configuration publique du service Ember est absente de cette application.',
      error
    );
  }
  return immutableServiceConfig(parseBundledServiceConfig(raw).serviceUrl);
}

function parseBundledServiceConfig(raw) {
  let value;
  try {
    value = JSON.parse(String(raw));
  } catch (error) {
    throw new PublicServiceConfigError(
      'EMBER_SERVICE_CONFIG_INVALID',
      'La configuration publique du service Ember est illisible.',
      error
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidConfig();
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !ALLOWED_CONFIG_KEYS.has(key))
    || value.schemaVersion !== SERVICE_CONFIG_SCHEMA_VERSION) {
    throw invalidConfig();
  }
  return {
    schemaVersion: SERVICE_CONFIG_SCHEMA_VERSION,
    serviceUrl: normalizeServiceUrl(value.serviceUrl)
  };
}

function serializeBundledServiceConfig(serviceUrl) {
  const payload = {
    schemaVersion: SERVICE_CONFIG_SCHEMA_VERSION,
    serviceUrl: normalizeServiceUrl(serviceUrl)
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function normalizeServiceUrl(value, { allowLocalhost = false } = {}) {
  if (typeof value !== 'string'
    || value !== value.trim()
    || value.length < 9
    || value.length > 2_048
    || /[\u0000-\u0020\u007f]/.test(value)) {
    throw invalidUrl();
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new PublicServiceConfigError(
      'EMBER_SERVICE_URL_INVALID',
      'L’adresse publique du service Ember est invalide.',
      error
    );
  }

  const local = isLocalHostname(parsed.hostname);
  const protocolAllowed = parsed.protocol === 'https:'
    || (allowLocalhost && parsed.protocol === 'http:' && local);
  if (!protocolAllowed
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || value.includes('?')
    || value.includes('#')) {
    throw new PublicServiceConfigError(
      parsed.protocol === 'http:' && !local
        ? 'EMBER_SERVICE_URL_INSECURE'
        : 'EMBER_SERVICE_URL_INVALID',
      allowLocalhost
        ? 'Le service Ember doit utiliser HTTPS, sauf localhost en développement.'
        : 'Un build distribué d’Ember exige une URL HTTPS publique sans identifiants, paramètres ni fragment.'
    );
  }
  if (!allowLocalhost && local) {
    throw new PublicServiceConfigError(
      'EMBER_SERVICE_URL_NOT_PUBLIC',
      'Un build distribué d’Ember ne peut pas utiliser une adresse localhost.'
    );
  }
  return parsed.toString().replace(/\/+$/, '');
}

function immutableServiceConfig(serviceUrl) {
  return Object.freeze({
    backend: Object.freeze({ url: serviceUrl })
  });
}

function isLocalHostname(value) {
  const hostname = String(value || '').toLowerCase();
  return hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '::1'
    || hostname === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

function invalidConfig() {
  return new PublicServiceConfigError(
    'EMBER_SERVICE_CONFIG_INVALID',
    'La configuration publique du service Ember contient des champs non autorisés.'
  );
}

function invalidUrl() {
  return new PublicServiceConfigError(
    'EMBER_SERVICE_URL_INVALID',
    'L’adresse publique du service Ember est invalide.'
  );
}

module.exports = {
  BUNDLED_SERVICE_CONFIG_FILENAME,
  DEVELOPMENT_SERVICE_URL,
  PublicServiceConfigError,
  normalizeServiceUrl,
  parseBundledServiceConfig,
  resolveDesktopServiceConfig,
  serializeBundledServiceConfig
};
