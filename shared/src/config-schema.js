/**
 * ember.config.json schema + validator.
 *
 * Hand-rolled validation (no runtime deps) so the agent stays installable
 * anywhere. The schema doubles as documentation: see docs/config.md.
 */

export const CONFIG_VERSION = 1;

const ENGINE_VALUES = ['unity', 'unreal', 'godot', 'web', 'custom'];

/** Field spec: [type, required, description] */
export const CONFIG_FIELDS = {
  $schema: ['string', false, 'Optional JSON schema reference'],
  configVersion: ['number', false, 'Config format version'],
  projectName: ['string', true, 'Human-readable project name'],
  engine: ['string', true, `Game engine: ${ENGINE_VALUES.join(', ')}`],
  gamePath: ['string', false, 'Path to the game project root (defaults to config location)'],
  buildCommand: ['string', false, 'Command that builds the game (e.g. "npm run build", Unity batchmode call)'],
  launchCommand: ['string', false, 'Command that launches the game'],
  testCommand: ['string', false, 'Command that runs the engine test suite'],
  logsPath: ['string', false, 'Folder (or file) where the game writes logs'],
  screenshotsPath: ['string', false, 'Folder where screenshots/captures are stored'],
  crashReportsPath: ['string', false, 'Folder where crash dumps/reports are written'],
  sourcePaths: ['string[]', false, 'Folders to include in code analysis (defaults per engine)'],
  ignorePaths: ['string[]', false, 'Folders/globs excluded from scans'],
  includeExtensions: ['string[]', false, 'File extensions to analyze (defaults per engine)'],
  excludeExtensions: ['string[]', false, 'File extensions to skip'],
  maxFiles: ['number', false, 'Max files to analyze per run (default 5000)'],
  testProfiles: ['object', false, 'Named test profiles: { smoke: { checks: [...], commands: [...] } }'],
  webRunner: ['object', false, 'Forward-compatible Web runner configuration'],
  customRules: ['array', false, 'Custom analysis rules: { id, pattern, flags?, message, severity, category, extensions? }'],
  scenarios: ['array', false, 'Recorded playtest scenarios: { id, name, steps: string[], expectedResult, createdAt }'],
  backend: ['object', false, 'Optional backend sync: { url, projectId?, token? (prefer EMBER_AGENT_TOKEN env) }']
};

export const SAMPLE_CONFIG = {
  configVersion: CONFIG_VERSION,
  projectName: 'My Game',
  engine: 'unity',
  gamePath: '.',
  buildCommand: '',
  launchCommand: '',
  testCommand: '',
  logsPath: 'Logs',
  screenshotsPath: 'Screenshots',
  crashReportsPath: 'CrashReports',
  sourcePaths: ['Assets/Scripts'],
  ignorePaths: ['Library', 'Temp', 'obj', 'node_modules', '.git'],
  includeExtensions: ['.cs', '.shader', '.json', '.asmdef'],
  excludeExtensions: ['.meta', '.png', '.fbx', '.wav'],
  maxFiles: 5000,
  testProfiles: {
    smoke: {
      description: 'Fast pass: scan, analyze, parse logs',
      checks: ['scan', 'analyze', 'logs'],
      commands: []
    },
    full: {
      description: 'Everything, including configured build & test commands',
      checks: ['scan', 'analyze', 'logs', 'build', 'test'],
      commands: []
    }
  },
  customRules: [
    {
      id: 'no-force-unwrap-save',
      pattern: 'PlayerPrefs\\.GetString\\([^)]*\\)\\s*\\.',
      message: 'Chained call on PlayerPrefs value without null/empty check',
      severity: 'medium',
      category: 'save-system',
      extensions: ['.cs']
    }
  ],
  scenarios: [],
  backend: {
    url: '',
    projectId: ''
  }
};

/**
 * Validate a parsed config object.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateConfig(config) {
  const errors = [];
  const warnings = [];

  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return { valid: false, errors: ['Config must be a JSON object'], warnings };
  }

  for (const [key, [type, required]] of Object.entries(CONFIG_FIELDS)) {
    const value = config[key];
    if (value === undefined || value === null) {
      if (required) errors.push(`Missing required field "${key}"`);
      continue;
    }
    switch (type) {
      case 'string':
        if (typeof value !== 'string') errors.push(`"${key}" must be a string`);
        break;
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) errors.push(`"${key}" must be a number`);
        break;
      case 'string[]':
        if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
          errors.push(`"${key}" must be an array of strings`);
        break;
      case 'array':
        if (!Array.isArray(value)) errors.push(`"${key}" must be an array`);
        break;
      case 'object':
        if (typeof value !== 'object' || Array.isArray(value)) errors.push(`"${key}" must be an object`);
        break;
    }
  }

  if (typeof config.engine === 'string' && !ENGINE_VALUES.includes(config.engine)) {
    errors.push(`"engine" must be one of: ${ENGINE_VALUES.join(', ')} (got "${config.engine}")`);
  }

  for (const key of Object.keys(config)) {
    if (!(key in CONFIG_FIELDS)) warnings.push(`Unknown field "${key}" (ignored)`);
  }

  if (Array.isArray(config.customRules)) {
    config.customRules.forEach((rule, i) => {
      if (!rule || typeof rule !== 'object') return errors.push(`customRules[${i}] must be an object`);
      if (!rule.id) errors.push(`customRules[${i}] is missing "id"`);
      if (!rule.pattern) errors.push(`customRules[${i}] is missing "pattern"`);
      else {
        try {
          new RegExp(rule.pattern, rule.flags ?? '');
        } catch (e) {
          errors.push(`customRules[${i}].pattern is not a valid regex: ${e.message}`);
        }
      }
    });
  }

  if (!config.buildCommand && !config.testCommand && !config.launchCommand) {
    warnings.push('No buildCommand/testCommand/launchCommand configured — Ember can scan and analyze, but cannot execute your game or its tests yet.');
  }
  if (!config.logsPath) {
    warnings.push('No logsPath configured — log analysis will be skipped.');
  }

  return { valid: errors.length === 0, errors, warnings };
}
