/**
 * Core enums and constants shared by the agent, backend, desktop app and web site.
 */

export const PRODUCT_NAME = 'Ember';
export const AGENT_NAME = 'Ember Agent';
export const DESKTOP_NAME = 'Ember Desktop';
export const CONFIG_FILENAME = 'ember.config.json';
export const DEFAULT_BACKEND_URL = 'http://localhost:4310';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];

export const BUG_CATEGORIES = [
  'crash',
  'gameplay',
  'ui',
  'visual',
  'performance',
  'audio',
  'save-system',
  'input',
  'network',
  'build'
];

export const BUG_SOURCES = [
  'code-analysis',
  'logs',
  'test-run',
  'manual-report',
  'crash-report'
];

export const BUG_STATUSES = ['open', 'investigating', 'fixed', 'verified', 'wont-fix'];

export const TEST_RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'blocked', 'cancelled'];

export const DATA_MODES = {
  REAL: 'real',
  DEMO: 'demo',
  NOT_CONNECTED: 'not-connected'
};

export const TEAM_ROLES = ['owner', 'admin', 'developer', 'qa', 'viewer'];

export const NOTIFICATION_TYPES = [
  'test-completed',
  'critical-bug-found',
  'report-generated',
  'payment-issue',
  'agent-disconnected',
  'teammate-invited',
  'export-completed',
  'import-failed',
  'config-invalid'
];

export const NOTIFICATION_CHANNELS = ['in-app', 'email', 'slack', 'discord'];

/**
 * Professional metrics tracked by Ember. There is intentionally no
 * "stability score" — each metric is a concrete, verifiable signal.
 */
export const METRICS = [
  { key: 'bugsFound', label: 'Bugs found' },
  { key: 'crashRisk', label: 'Crash risk' },
  { key: 'failedChecks', label: 'Failed checks' },
  { key: 'testCoverage', label: 'Test coverage' },
  { key: 'reproducibilityConfidence', label: 'Reproducibility confidence' },
  { key: 'affectedSystems', label: 'Affected systems' },
  { key: 'regressionRisk', label: 'Regression risk' },
  { key: 'performanceWarnings', label: 'Performance warnings' },
  { key: 'buildHealth', label: 'Build health' },
  { key: 'severityBreakdown', label: 'Issue severity breakdown' },
  { key: 'logsAnalyzed', label: 'Logs analyzed' },
  { key: 'filesScanned', label: 'Files scanned' },
  { key: 'commandsExecuted', label: 'Commands executed' },
  { key: 'testPlansCompleted', label: 'Test plans completed' }
];

export const EXPORT_FORMATS = ['json', 'markdown', 'pdf'];

/** Simple id generator: prefix + timestamp + random. Collision-safe enough for local use. */
export function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
