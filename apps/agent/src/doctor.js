import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { DEFAULT_BACKEND_URL } from '@ember/shared/constants';
import { loadConfig } from './config.js';
import { aiStatus } from './ai.js';

/**
 * Environment + configuration diagnostics. Each check reports
 * ok | warn | fail with a concrete remedy.
 */
export async function doctor(dir = process.cwd()) {
  const checks = [];
  const add = (name, status, detail, remedy = null) => checks.push({ name, status, detail, remedy });

  // Node version
  const [major] = process.versions.node.split('.').map(Number);
  add('Node.js', major >= 20 ? 'ok' : 'fail', `v${process.versions.node}`, major >= 20 ? null : 'Ember Agent requires Node 20+');

  // Git available
  try {
    const v = execFileSync('git', ['--version'], { stdio: 'pipe' }).toString().trim();
    add('Git', 'ok', v);
  } catch {
    add('Git', 'warn', 'git not found on PATH', 'Install git to enable repository-aware features');
  }

  // Config
  const { config, path, root, errors, warnings } = loadConfig(dir);
  if (!path) {
    add('ember.config.json', 'fail', 'not found', 'Run `ember init` in your game project root');
  } else if (!config) {
    add('ember.config.json', 'fail', errors.join('; '), 'Fix the config errors, then re-run `ember config validate`');
  } else {
    add('ember.config.json', 'ok', path);
    for (const w of warnings) add('config warning', 'warn', w);

    const checkPath = (label, value) => {
      if (!value) return add(label, 'warn', 'not configured', `Set "${label}" in ember.config.json`);
      const abs = isAbsolute(value) ? value : resolve(root, value);
      add(label, existsSync(abs) ? 'ok' : 'fail', abs, existsSync(abs) ? null : 'Path does not exist');
    };
    checkPath('logsPath', config.logsPath);
    if (config.screenshotsPath) checkPath('screenshotsPath', config.screenshotsPath);
    if (config.crashReportsPath) checkPath('crashReportsPath', config.crashReportsPath);

    for (const field of ['buildCommand', 'testCommand', 'launchCommand']) {
      add(field, config[field] ? 'ok' : 'warn', config[field] || 'not configured', config[field] ? null : `Set "${field}" to let Ember execute it`);
    }
  }

  // Backend reachability
  const backendUrl = config?.backend?.url || process.env.API_URL || DEFAULT_BACKEND_URL;
  try {
    const res = await fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(3000) });
    const body = await res.json().catch(() => ({}));
    add('Backend', res.ok ? 'ok' : 'warn', `${backendUrl} → ${res.status}${body.version ? ` (v${body.version})` : ''}`, res.ok ? null : 'Backend responded but not healthy');
  } catch {
    add('Backend', 'warn', `${backendUrl} unreachable`, 'Ember works fully offline; start the backend (npm run dev:backend) to enable sync');
  }

  // AI (optional)
  const ai = aiStatus();
  const aiDetail = ai.enabled
    ? `enabled — ${ai.label} (${ai.model})${ai.fallback?.length ? ` · falls back to ${ai.fallback.map((p) => (p === 'claude' ? 'Claude Fable 5' : 'OpenAI')).join(', ')}` : ''}`
    : 'not configured';
  add('AI', ai.enabled ? 'ok' : 'warn', aiDetail, ai.enabled ? null : ai.reason);

  const failed = checks.filter((chk) => chk.status === 'fail').length;
  const warned = checks.filter((chk) => chk.status === 'warn').length;
  return { checks, failed, warned, healthy: failed === 0 };
}
