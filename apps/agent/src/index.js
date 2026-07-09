/**
 * @ember/agent — programmatic API.
 * Used by the CLI (bin/ember.js), Ember Desktop (via Electron main process)
 * and the backend's agent endpoints.
 */
export { loadConfig, findConfig, generateConfig, validateConfig } from './config.js';
export { detectEngine } from './detect.js';
export { scanProject } from './scan.js';
export { analyzeCode } from './analyze.js';
export { analyzeLogs } from './logs.js';
export { runCommand, runProfile, extractCommandSignals } from './runner.js';
export { bugsFromRun } from './bugs.js';
export { buildReport, reportToMarkdown } from './report.js';
export { doctor } from './doctor.js';
export { BackendClient, backendFromConfig } from './backend-client.js';
export { LocalStore } from './store.js';
export { maskSecrets } from './util.js';
export { aiConfigured, aiStatus, explainBug, summarizeReport, triageBug } from './ai.js';
