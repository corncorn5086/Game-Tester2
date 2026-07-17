const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const {
  packageDesktop,
  parseBuildArguments,
  sanitizedBuildEnvironment
} = require('./package-desktop.cjs');

const desktopDir = mkdtempSync(join(tmpdir(), 'ember-desktop-package-'));
const generatedConfig = join(desktopDir, 'build', 'ember-service.json');
try {
  assert.deepEqual(
    parseBuildArguments(['--win', '--service-url=https://api.ember.example/']),
    { platform: '--win', serviceUrl: 'https://api.ember.example' }
  );
  assert.throws(
    () => parseBuildArguments(['--win']),
    (error) => error.code === 'DESKTOP_SERVICE_URL_REQUIRED'
  );
  assert.throws(
    () => parseBuildArguments(['--service-url=http://api.ember.example']),
    (error) => error.code === 'EMBER_SERVICE_URL_INSECURE'
  );
  assert.throws(
    () => parseBuildArguments(['--service-url=https://api.ember.example', '--api-key=forbidden']),
    (error) => error.code === 'DESKTOP_BUILD_ARGUMENT_INVALID'
  );

  const sanitized = sanitizedBuildEnvironment({
    PATH: 'safe',
    OPENAI_API_KEY: 'must-not-reach-builder',
    ANTHROPIC_TOKEN: 'must-not-reach-builder',
    EMBER_MANAGED_API_URL: 'https://env-override.invalid',
    API_URL: 'https://env-override.invalid'
  });
  assert.deepEqual(sanitized, { PATH: 'safe' });

  let observedConfig;
  const success = packageDesktop(
    ['--linux', '--service-url', 'https://api.ember.example'],
    {
      desktopDir,
      builderCliPath: 'mock-electron-builder.cjs',
      environment: { PATH: 'safe', OPENAI_API_KEY: 'forbidden' },
      spawnSync(_runtime, args, options) {
        observedConfig = JSON.parse(readFileSync(generatedConfig, 'utf8'));
        assert.deepEqual(args, ['mock-electron-builder.cjs', '--linux']);
        assert.equal(options.cwd, desktopDir);
        assert.equal(options.env.OPENAI_API_KEY, undefined);
        return { status: 0 };
      }
    }
  );
  assert.equal(success, 0);
  assert.equal(observedConfig.serviceUrl, 'https://api.ember.example');
  assert.equal(existsSync(generatedConfig), false);

  const failed = packageDesktop(
    ['--service-url=https://api.ember.example'],
    {
      desktopDir,
      builderCliPath: 'mock-electron-builder.cjs',
      spawnSync() { return { status: 9 }; }
    }
  );
  assert.equal(failed, 9);
  assert.equal(existsSync(generatedConfig), false);

  assert.throws(
    () => packageDesktop(
      ['--service-url=https://api.ember.example'],
      {
        desktopDir,
        builderCliPath: 'mock-electron-builder.cjs',
        spawnSync() { throw new Error('simulated spawn failure'); }
      }
    ),
    /simulated spawn failure/
  );
  assert.equal(existsSync(generatedConfig), false);

  console.log('✓ desktop packaging service URL tests passed');
} finally {
  const safeRoot = resolve(tmpdir());
  const target = resolve(desktopDir);
  if (!target.startsWith(safeRoot) || !target.includes('ember-desktop-package-')) {
    throw new Error('Unsafe test cleanup target');
  }
  rmSync(target, { recursive: true, force: true });
}
