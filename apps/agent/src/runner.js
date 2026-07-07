import { spawn } from 'node:child_process';
import { CHECK_TYPES, getCheck } from '@ember/shared/checks';
import { analyzeCode } from './analyze.js';
import { analyzeLogs } from './logs.js';
import { scanProject } from './scan.js';
import { maskSecrets, nowIso } from './util.js';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CAPTURED_OUTPUT = 200 * 1024;

/**
 * Execute one configured shell command, capturing output and exit code.
 * Real execution — the caller decides which configured command to run.
 */
export function runCommand(command, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, onOutput } = {}) {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    const child = spawn(command, { cwd, shell: true, env: process.env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const capture = (buf, isErr) => {
      const text = maskSecrets(buf.toString());
      if (isErr) stderr = (stderr + text).slice(-MAX_CAPTURED_OUTPUT);
      else stdout = (stdout + text).slice(-MAX_CAPTURED_OUTPUT);
      onOutput?.(text, isErr);
    };
    child.stdout.on('data', (d) => capture(d, false));
    child.stderr.on('data', (d) => capture(d, true));

    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({
        command,
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        exitCode: null,
        timedOut,
        spawnError: err.message,
        stdout,
        stderr,
        failed: true
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({
        command,
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        exitCode: code,
        timedOut,
        spawnError: null,
        stdout,
        stderr,
        failed: timedOut || code !== 0
      });
    });
  });
}

/** Extract error-looking lines from command output as evidence. */
export function extractCommandSignals(execution) {
  const signals = [];
  const text = `${execution.stdout}\n${execution.stderr}`;
  const errorLines = text
    .split('\n')
    .filter((l) => /\b(error|exception|fatal|failed|assert(ion)? failed|segfault|traceback)\b/i.test(l) && !/0 errors?/i.test(l))
    .slice(0, 40)
    .map((l) => l.trim().slice(0, 300));

  if (execution.spawnError) {
    signals.push({ label: 'Command could not start', severity: 'high', category: 'build', evidence: execution.spawnError });
  }
  if (execution.timedOut) {
    signals.push({ label: 'Command timed out', severity: 'high', category: 'performance', evidence: `Killed after ${Math.round(execution.durationMs / 1000)}s: ${execution.command}` });
  }
  if (execution.exitCode !== null && execution.exitCode !== 0) {
    signals.push({ label: `Command exited with code ${execution.exitCode}`, severity: 'high', category: 'build', evidence: errorLines[0] ?? execution.command, errorLines });
  } else if (errorLines.length > 0 && !execution.failed) {
    signals.push({ label: 'Errors in command output (exit 0)', severity: 'medium', category: 'build', evidence: errorLines[0], errorLines });
  }
  return signals;
}

/**
 * Run a named test profile from ember.config.json.
 * Emits step events via onStep so the desktop app / CLI can render live progress.
 * Checks that need an engine integration are reported as `blocked`, never faked.
 */
export async function runProfile(config, root, profileName, { onStep } = {}) {
  const startedAt = Date.now();
  const profile = config?.testProfiles?.[profileName];
  const run = {
    kind: 'test-run',
    profile: profileName,
    startedAt: nowIso(),
    steps: [],
    commandsExecuted: 0,
    checksPassed: 0,
    checksFailed: 0,
    checksBlocked: 0,
    status: 'running',
    scan: null,
    analyze: null,
    logs: null,
    executions: []
  };

  const step = (payload) => {
    const entry = { at: nowIso(), ...payload };
    run.steps.push(entry);
    onStep?.(entry);
    return entry;
  };

  if (!profile) {
    const available = Object.keys(config?.testProfiles ?? {});
    step({ type: 'error', check: null, message: `Test profile "${profileName}" not found. Available: ${available.join(', ') || '(none — add testProfiles to ember.config.json)'}` });
    run.status = 'blocked';
    run.finishedAt = nowIso();
    run.durationMs = Date.now() - startedAt;
    return run;
  }

  const checks = profile.checks ?? [];
  step({ type: 'start', message: `Running profile "${profileName}" (${checks.length} checks) in ${root}` });

  for (const checkId of checks) {
    const check = getCheck(checkId);
    if (!check) {
      step({ type: 'blocked', check: checkId, message: `Unknown check "${checkId}" — valid checks: ${CHECK_TYPES.map((x) => x.id).join(', ')}` });
      run.checksBlocked++;
      continue;
    }

    if (check.kind === 'integration') {
      step({ type: 'blocked', check: checkId, message: `"${check.label}" requires an engine integration (SDK/input driver) that is not installed yet. ${check.description}` });
      run.checksBlocked++;
      continue;
    }

    if (check.kind === 'agent') {
      step({ type: 'running', check: checkId, message: `Running ${check.label}…` });
      try {
        if (checkId === 'scan') {
          run.scan = scanProject(config, root);
          step({ type: 'done', check: checkId, message: `Scanned ${run.scan.filesScanned} files (${run.scan.sourceFileCount} sources) — engine: ${run.scan.engineDetection.engine} [${run.scan.engineDetection.confidence}]` });
          run.checksPassed++;
        } else if (checkId === 'analyze') {
          run.analyze = analyzeCode(config, root, { scan: run.scan ?? undefined });
          const sev = run.analyze.bySeverity;
          const failed = sev.critical + sev.high > 0;
          step({ type: failed ? 'failed' : 'done', check: checkId, message: `${run.analyze.findingCount} findings (critical ${sev.critical}, high ${sev.high}, medium ${sev.medium}, low ${sev.low}) across ${run.analyze.filesAnalyzed} files` });
          failed ? run.checksFailed++ : run.checksPassed++;
        } else if (checkId === 'logs') {
          run.logs = analyzeLogs(config, root);
          if (run.logs.blockers.length > 0 && run.logs.logsAnalyzed === 0) {
            step({ type: 'blocked', check: checkId, message: run.logs.blockers[0].message });
            run.checksBlocked++;
          } else {
            const crit = run.logs.signals.filter((s) => s.severity === 'critical').length;
            const failed = crit > 0;
            step({ type: failed ? 'failed' : 'done', check: checkId, message: `Analyzed ${run.logs.logsAnalyzed} log file(s), ${run.logs.linesRead} lines — ${run.logs.signals.length} signal(s), ${crit} critical` });
            failed ? run.checksFailed++ : run.checksPassed++;
          }
        } else if (checkId === 'regression') {
          step({ type: 'done', check: checkId, message: 'Regression baseline recorded — compare with `ember report` after your next run.' });
          run.checksPassed++;
        }
      } catch (e) {
        step({ type: 'failed', check: checkId, message: `${check.label} crashed: ${e.message}` });
        run.checksFailed++;
      }
      continue;
    }

    if (check.kind === 'command') {
      const command = check.commandField ? config[check.commandField] : null;
      if (check.commandField && !command) {
        step({ type: 'blocked', check: checkId, message: `run command missing — set "${check.commandField}" in ember.config.json to enable ${check.label}.` });
        run.checksBlocked++;
        continue;
      }
      step({ type: 'running', check: checkId, message: `$ ${command}` });
      const execution = await runCommand(command, {
        cwd: root,
        onOutput: (text) => onStep?.({ at: nowIso(), type: 'output', check: checkId, message: text })
      });
      run.commandsExecuted++;
      execution.check = checkId;
      execution.signals = extractCommandSignals(execution);
      run.executions.push(execution);
      if (execution.failed) {
        step({ type: 'failed', check: checkId, message: `Exit ${execution.exitCode ?? 'n/a'}${execution.timedOut ? ' (timeout)' : ''}${execution.spawnError ? ` — ${execution.spawnError}` : ''}` });
        run.checksFailed++;
      } else {
        step({ type: 'done', check: checkId, message: `Completed in ${(execution.durationMs / 1000).toFixed(1)}s (exit 0)` });
        run.checksPassed++;
      }
    }
  }

  // Extra profile commands (always executed if present)
  for (const cmd of profile.commands ?? []) {
    step({ type: 'running', check: 'custom-command', message: `$ ${cmd}` });
    const execution = await runCommand(cmd, {
      cwd: root,
      onOutput: (text) => onStep?.({ at: nowIso(), type: 'output', check: 'custom-command', message: text })
    });
    run.commandsExecuted++;
    execution.check = 'custom-command';
    execution.signals = extractCommandSignals(execution);
    run.executions.push(execution);
    if (execution.failed) {
      step({ type: 'failed', check: 'custom-command', message: `Exit ${execution.exitCode ?? 'n/a'} — ${cmd}` });
      run.checksFailed++;
    } else {
      step({ type: 'done', check: 'custom-command', message: `Completed in ${(execution.durationMs / 1000).toFixed(1)}s` });
      run.checksPassed++;
    }
  }

  run.status = run.checksFailed > 0 ? 'failed' : run.checksPassed > 0 ? 'completed' : 'blocked';
  run.finishedAt = nowIso();
  run.durationMs = Date.now() - startedAt;
  step({ type: 'finish', message: `Profile "${profileName}" ${run.status}: ${run.checksPassed} passed, ${run.checksFailed} failed, ${run.checksBlocked} blocked, ${run.commandsExecuted} command(s) executed.` });
  return run;
}
