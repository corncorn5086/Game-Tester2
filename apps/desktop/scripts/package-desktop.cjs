#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const {
  BUNDLED_SERVICE_CONFIG_FILENAME,
  normalizeServiceUrl,
  serializeBundledServiceConfig
} = require('../electron/public-service-config.cjs');

const PLATFORM_FLAGS = new Set(['--win', '--mac', '--linux']);
const PROVIDER_SECRET_ENV = /(?:OPENAI|ANTHROPIC|CLAUDE).*(?:(?:API[_-]?)?KEY|TOKEN|SECRET)|(?:(?:API[_-]?)?KEY|TOKEN|SECRET).*(?:OPENAI|ANTHROPIC|CLAUDE)/i;

class DesktopPackagingError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DesktopPackagingError';
    this.code = code;
  }
}

function parseBuildArguments(argv = []) {
  let platform = null;
  let serviceUrl = null;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (PLATFORM_FLAGS.has(argument)) {
      if (platform && platform !== argument) {
        throw new DesktopPackagingError('DESKTOP_BUILD_ARGUMENT_INVALID', 'Choisissez une seule plateforme de build.');
      }
      platform = argument;
      continue;
    }
    if (argument === '--service-url') {
      if (serviceUrl !== null || typeof argv[index + 1] !== 'string') throw invalidServiceArgument();
      serviceUrl = argv[++index];
      continue;
    }
    if (typeof argument === 'string' && argument.startsWith('--service-url=')) {
      if (serviceUrl !== null) throw invalidServiceArgument();
      serviceUrl = argument.slice('--service-url='.length);
      continue;
    }
    throw new DesktopPackagingError(
      'DESKTOP_BUILD_ARGUMENT_INVALID',
      `Argument de build inconnu: ${String(argument || '(vide)')}`
    );
  }
  if (!serviceUrl) throw invalidServiceArgument();
  return { platform, serviceUrl: normalizeServiceUrl(serviceUrl) };
}

/**
 * Generate the public endpoint resource only for the duration of packaging.
 * The generated JSON is removed in the finally block on success, failure, or
 * a missing electron-builder installation.
 */
function packageDesktop(argv = process.argv.slice(2), dependencies = {}) {
  const { platform, serviceUrl } = parseBuildArguments(argv);
  const desktopDir = resolve(dependencies.desktopDir || join(__dirname, '..'));
  const generatedDir = join(desktopDir, 'build');
  const generatedConfigPath = join(generatedDir, BUNDLED_SERVICE_CONFIG_FILENAME);
  const spawn = dependencies.spawnSync || spawnSync;
  const builderCliPath = dependencies.builderCliPath || require.resolve('electron-builder/out/cli/cli.js');
  const environment = sanitizedBuildEnvironment(dependencies.environment || process.env);

  mkdirSync(generatedDir, { recursive: true });
  try {
    // A previous interrupted build must never influence the next package.
    rmSync(generatedConfigPath, { force: true });
    writeFileSync(generatedConfigPath, serializeBundledServiceConfig(serviceUrl), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o644
    });

    const bundled = JSON.parse(readFileSync(generatedConfigPath, 'utf8'));
    if (bundled.serviceUrl !== serviceUrl) {
      throw new DesktopPackagingError('DESKTOP_SERVICE_CONFIG_WRITE_FAILED', 'La vérification de l’URL Ember embarquée a échoué.');
    }

    const result = spawn(process.execPath, [builderCliPath, ...(platform ? [platform] : [])], {
      cwd: desktopDir,
      stdio: 'inherit',
      env: environment,
      windowsHide: true
    });
    if (result?.error) {
      throw new DesktopPackagingError('DESKTOP_BUILDER_FAILED', 'electron-builder n’a pas pu démarrer.', result.error);
    }
    return Number.isInteger(result?.status) ? result.status : 1;
  } finally {
    rmSync(generatedConfigPath, { force: true });
    try { rmdirSync(generatedDir); } catch { /* keep an existing non-empty build directory */ }
  }
}

function sanitizedBuildEnvironment(environment) {
  const safe = {};
  for (const [name, value] of Object.entries(environment || {})) {
    if (PROVIDER_SECRET_ENV.test(name)) continue;
    if (name === 'EMBER_MANAGED_API_URL' || name === 'API_URL') continue;
    safe[name] = value;
  }
  return safe;
}

function invalidServiceArgument() {
  return new DesktopPackagingError(
    'DESKTOP_SERVICE_URL_REQUIRED',
    'Ajoutez --service-url=https://votre-service-ember au build distribué.'
  );
}

if (require.main === module) {
  try {
    process.exitCode = packageDesktop();
  } catch (error) {
    console.error(`[ember-desktop] ${error?.code || 'DESKTOP_BUILD_FAILED'}: ${error?.message || error}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DesktopPackagingError,
  packageDesktop,
  parseBuildArguments,
  sanitizedBuildEnvironment
};
