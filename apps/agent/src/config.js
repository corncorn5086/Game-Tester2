import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { CONFIG_FILENAME } from '@ember/shared/constants';
import { CONFIG_VERSION, validateConfig } from '@ember/shared/config-schema';
import { ENGINES } from '@ember/shared/engines';
import { validateProjectRoot } from '@ember/shared/project-validator';
import { detectEngine } from './detect.js';

export { validateConfig };

/** Find ember.config.json walking up from `dir`. */
export function findConfig(dir = process.cwd()) {
  let current = resolve(dir);
  for (;;) {
    const candidate = join(current, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Load and validate the config.
 * @returns {{ config: object|null, path: string|null, root: string|null, errors: string[], warnings: string[] }}
 */
export function loadConfig(dir = process.cwd()) {
  const path = findConfig(dir);
  if (!path) {
    return {
      config: null,
      path: null,
      root: null,
      errors: [`No ${CONFIG_FILENAME} found in ${dir} or any parent. Run \`ember init\` inside your game project.`],
      warnings: []
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { config: null, path, root: dirname(path), errors: [`${CONFIG_FILENAME} is not valid JSON: ${e.message}`], warnings: [] };
  }
  const { valid, errors, warnings } = validateConfig(parsed);
  const root = parsed.gamePath ? resolve(dirname(path), parsed.gamePath) : dirname(path);
  return { config: valid ? parsed : null, path, root, errors, warnings };
}

/**
 * Generate a config for a project directory, using engine detection
 * and per-engine defaults. Does not write unless `write` is true.
 */
export function generateConfig(dir = process.cwd(), { engine: forcedEngine, projectName, write = false, force = false, confirmedCustom = false } = {}) {
  const root = resolve(dir);

  // Never write a config into a folder that is not a real project
  // (system roots, empty/media folders, node_modules…). --force overwrites
  // an existing config; it does NOT bypass validation.
  const validation = validateProjectRoot(root, { confirmedCustom: confirmedCustom || Boolean(forcedEngine) });
  if (!validation.valid) {
    return {
      config: null,
      detection: { engine: 'custom', confidence: 'none', evidence: validation.evidence },
      validation,
      path: join(root, CONFIG_FILENAME),
      written: false,
      error: `This folder does not appear to contain a supported game or code project.\n  ${validation.errors.join('\n  ')}`
    };
  }
  if (validation.requiresConfirmation) {
    return {
      config: null,
      detection: { engine: validation.engine, confidence: validation.confidence, evidence: validation.evidence },
      validation,
      path: join(root, CONFIG_FILENAME),
      written: false,
      error: 'Weakly recognized project — confirm it is a code project by re-running with an explicit --engine (e.g. --engine custom).'
    };
  }

  const detection = detectEngine(root);
  const engineKey = forcedEngine ?? detection.engine;
  const profile = ENGINES[engineKey] ?? ENGINES.custom;

  const config = {
    configVersion: CONFIG_VERSION,
    projectName: projectName ?? basename(root),
    engine: engineKey,
    gamePath: '.',
    buildCommand: '',
    launchCommand: '',
    testCommand: '',
    logsPath: '',
    screenshotsPath: '',
    crashReportsPath: '',
    sourcePaths: profile.analyze.sourcePaths,
    ignorePaths: profile.analyze.ignorePaths,
    includeExtensions: profile.analyze.includeExtensions,
    excludeExtensions: [],
    maxFiles: 5000,
    testProfiles: {
      smoke: { description: 'Fast pass: scan, analyze, parse logs', checks: ['scan', 'analyze', 'logs'], commands: [] },
      full: { description: 'Everything, including configured build & test commands', checks: ['scan', 'analyze', 'logs', 'build', 'test'], commands: [] }
    },
    customRules: [],
    scenarios: [],
    backend: { url: '', projectId: '' }
  };

  const target = join(root, CONFIG_FILENAME);
  let written = false;
  if (write) {
    if (existsSync(target) && !force) {
      return { config, detection, path: target, written: false, error: `${CONFIG_FILENAME} already exists (use --force to overwrite)` };
    }
    writeFileSync(target, JSON.stringify(config, null, 2) + '\n');
    written = true;
  }
  return { config, detection, validation, path: target, written, error: null };
}
