const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const {
  BUNDLED_SERVICE_CONFIG_FILENAME,
  DEVELOPMENT_SERVICE_URL,
  normalizeServiceUrl,
  parseBundledServiceConfig,
  resolveDesktopServiceConfig,
  serializeBundledServiceConfig
} = require('./public-service-config.cjs');

const dataDir = mkdtempSync(join(tmpdir(), 'ember-public-service-config-'));
try {
  const development = resolveDesktopServiceConfig({
    isPackaged: false,
    resourcesPath: 'unused',
    environment: { EMBER_MANAGED_API_URL: 'https://env-override.invalid' },
    projectConfig: { backend: { url: 'https://project-override.invalid' } },
    readFile: () => { throw new Error('Development must not read a package resource'); }
  });
  assert.equal(development.backend.url, DEVELOPMENT_SERVICE_URL);
  assert.equal(Object.isFrozen(development), true);
  assert.equal(Object.isFrozen(development.backend), true);

  const publicUrl = 'https://api.ember.example/v1';
  const resource = serializeBundledServiceConfig(`${publicUrl}/`);
  writeFileSync(join(dataDir, BUNDLED_SERVICE_CONFIG_FILENAME), resource, 'utf8');
  const packaged = resolveDesktopServiceConfig({
    isPackaged: true,
    resourcesPath: dataDir,
    // These values model hostile client/project overrides and are ignored by
    // the resolver by design. The packaged resource remains authoritative.
    environment: { EMBER_MANAGED_API_URL: 'https://env-override.invalid' },
    projectConfig: { backend: { url: 'https://project-override.invalid' } }
  });
  assert.equal(packaged.backend.url, publicUrl);
  assert.deepEqual(Object.keys(JSON.parse(resource)).sort(), ['schemaVersion', 'serviceUrl']);
  assert.doesNotMatch(resource, /apiKey|token|secret/i);

  assert.equal(normalizeServiceUrl('https://api.ember.example/'), 'https://api.ember.example');
  assert.equal(
    normalizeServiceUrl('http://127.0.0.1:4310', { allowLocalhost: true }),
    'http://127.0.0.1:4310'
  );
  for (const value of [
    'http://api.ember.example',
    'https://localhost:4310',
    'https://user:pass@api.ember.example',
    'https://api.ember.example?workspace=one',
    'https://api.ember.example#fragment',
    ' https://api.ember.example'
  ]) {
    assert.throws(() => normalizeServiceUrl(value), (error) => /^EMBER_SERVICE_URL_/.test(error.code));
  }

  assert.throws(
    () => parseBundledServiceConfig('{"schemaVersion":1,"serviceUrl":"https://api.ember.example","apiKey":"forbidden"}'),
    (error) => error.code === 'EMBER_SERVICE_CONFIG_INVALID'
  );
  assert.throws(
    () => resolveDesktopServiceConfig({ isPackaged: true, resourcesPath: join(dataDir, 'missing') }),
    (error) => error.code === 'EMBER_SERVICE_CONFIG_MISSING'
  );

  // Security invariant: packaged auth/managed AI are wired to the immutable
  // Desktop config, not process.env or an editable project backend URL.
  const mainSource = readFileSync(join(__dirname, 'main.cjs'), 'utf8');
  assert.doesNotMatch(mainSource, /process\.env\.(?:EMBER_MANAGED_API_URL|API_URL)/);
  assert.doesNotMatch(mainSource, /getManagedServiceConfig\(/);
  assert.match(mainSource, /resolveDesktopServiceConfig\(/);

  console.log('✓ desktop public service config tests passed');
} finally {
  const safeRoot = resolve(tmpdir());
  const target = resolve(dataDir);
  if (!target.startsWith(safeRoot) || !target.includes('ember-public-service-config-')) {
    throw new Error('Unsafe test cleanup target');
  }
  rmSync(target, { recursive: true, force: true });
}
