import { spawn } from 'node:child_process';
import { CHECK_TYPES, getCheck } from '@ember/shared/checks';
import { analyzeCodeAsync } from './analyze.js';
import { analyzeLogs } from './logs.js';
import { scanProjectAsync } from './scan.js';
import { maskSecrets, maskSensitive, nowIso } from './util.js';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CAPTURED_OUTPUT = 200 * 1024;

/**
 * Execute one configured shell command, capturing output and exit code.
 * Real execution — the caller decides which configured command to run.
 */
export function runCommand(command, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, onOutput, signal } = {}) {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    const safeCommand = maskSecrets(command);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let child = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolvePromise({
        command: safeCommand,
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        timedOut,
        cancelled,
        cancelReason: cancelled ? abortReason(signal) : null,
        stdout,
        stderr,
        ...result
      });
    };

    const abort = () => {
      if (settled || cancelled) return;
      cancelled = true;
      terminateProcessTree(child);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      terminateProcessTree(child);
    }, timeoutMs);

    if (signal?.aborted) {
      cancelled = true;
      finish({ exitCode: null, spawnError: null, failed: true });
      return;
    }

    try {
      child = spawn(command, {
        cwd,
        shell: true,
        // Provider credentials belong to Ember's trusted AI transport. They
        // are deliberately removed from project-controlled build/test/launch
        // commands while remaining available to the agent's own AI calls.
        env: commandEnvironment(),
        windowsHide: true,
        // A separate process group lets POSIX cancellation stop commands
        // launched by the shell too, rather than only killing the shell.
        detached: process.platform !== 'win32'
      });
    } catch (err) {
      finish({ exitCode: null, spawnError: maskSecrets(err.message), failed: true });
      return;
    }

    signal?.addEventListener('abort', abort, { once: true });

    const capture = (buf, isErr) => {
      const text = maskSecrets(buf.toString());
      if (isErr) stderr = (stderr + text).slice(-MAX_CAPTURED_OUTPUT);
      else stdout = (stdout + text).slice(-MAX_CAPTURED_OUTPUT);
      try { onOutput?.(text, isErr); } catch { /* UI listeners must not crash a run */ }
    };
    child.stdout.on('data', (d) => capture(d, false));
    child.stderr.on('data', (d) => capture(d, true));

    child.on('error', (err) => {
      finish({ exitCode: null, spawnError: maskSecrets(err.message), failed: true });
    });
    child.on('close', (code) => {
      finish({ exitCode: code, spawnError: null, failed: timedOut || cancelled || code !== 0 });
    });
  });
}

function commandEnvironment() {
  const environment = { ...process.env };
  delete environment.ANTHROPIC_API_KEY;
  delete environment.OPENAI_API_KEY;
  return environment;
}

function abortReason(signal) {
  if (!signal?.reason) return 'Test cancelled by the user';
  return maskSecrets(signal.reason instanceof Error ? signal.reason.message : String(signal.reason));
}

/** Kill the shell and every process it launched. */
function terminateProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    killer.on('error', () => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    });
    const fallback = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, 1500);
    fallback.unref?.();
    return;
  }

  try { process.kill(-child.pid, 'SIGTERM'); }
  catch {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  const force = setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }
  }, 1500);
  force.unref?.();
}

/** Extract error-looking lines from command output as evidence. */
export function extractCommandSignals(execution) {
  if (execution.cancelled) return [];
  const signals = [];
  const text = `${execution.stdout}\n${execution.stderr}`;
  const errorLines = text
    .split('\n')
    .filter((l) => /\b(error|exception|fatal|failed|assert(ion)? failed|segfault|traceback)\b/i.test(l) && !/0 errors?/i.test(l))
    .slice(0, 40)
    .map((l) => l.trim().slice(0, 300));

  if (execution.spawnError) {
    signals.push({ label: 'Command could not start', severity: 'high', category: 'build', evidence: maskSecrets(execution.spawnError) });
  }
  if (execution.timedOut) {
    signals.push({ label: 'Command timed out', severity: 'high', category: 'performance', evidence: maskSecrets(`Killed after ${Math.round(execution.durationMs / 1000)}s: ${execution.command}`) });
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
export async function runProfile(config, root, profileName, { onStep, signal } = {}) {
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

  const notify = (payload) => {
    const safePayload = maskSensitive(payload);
    try { onStep?.(safePayload); } catch { /* observers cannot stop a run */ }
    return safePayload;
  };

  const step = (payload) => {
    const entry = maskSensitive({ at: nowIso(), ...payload });
    run.steps.push(entry);
    notify(entry);
    return entry;
  };

  // High-frequency progress is live telemetry, not durable report history.
  // Milestones still go through step() and remain in run.steps.
  const progress = (check, event) => notify({
    at: nowIso(),
    type: 'progress',
    check,
    message: progressMessage(event),
    ...event
  });

  const cancelRun = () => {
    const message = abortReason(signal);
    step({ type: 'cancelled', check: null, message });
    run.status = 'cancelled';
    run.finishedAt = nowIso();
    run.durationMs = Date.now() - startedAt;
    step({ type: 'finish', check: null, message: `Profile "${profileName}" cancelled.`, data: runCounts(run) });
    return run;
  };

  if (signal?.aborted) return cancelRun();

  if (!profile) {
    const available = Object.keys(config?.testProfiles ?? {});
    step({ type: 'error', check: null, message: `Test profile "${profileName}" not found. Available: ${available.join(', ') || '(none — add testProfiles to ember.config.json)'}` });
    run.status = 'blocked';
    run.finishedAt = nowIso();
    run.durationMs = Date.now() - startedAt;
    return run;
  }

  const checks = profile.checks ?? [];
  step({
    type: 'start',
    check: null,
    message: `Running profile "${profileName}" (${checks.length} checks) in ${root}`,
    data: { profile: profileName, checksTotal: checks.length, root }
  });

  for (const checkId of checks) {
    if (signal?.aborted) return cancelRun();
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
      step({ type: 'running', check: checkId, message: `Running ${check.label}…`, data: { kind: check.kind, label: check.label } });
      try {
        if (checkId === 'scan') {
          run.scan = await scanProjectAsync(config, root, {
            signal,
            onProgress: (event) => progress(checkId, event)
          });
          if (signal?.aborted) return cancelRun();
          step({
            type: 'done',
            check: checkId,
            message: `Scanned ${run.scan.filesScanned} files (${run.scan.sourceFileCount} sources) — engine: ${run.scan.engineDetection.engine} [${run.scan.engineDetection.confidence}]`,
            data: {
              filesScanned: run.scan.filesScanned,
              sourceFileCount: run.scan.sourceFileCount,
              directoriesVisited: run.scan.dirsVisited,
              totalBytes: run.scan.totalBytes,
              truncated: run.scan.truncated,
              engine: run.scan.engineDetection.engine,
              confidence: run.scan.engineDetection.confidence,
              durationMs: run.scan.durationMs
            }
          });
          run.checksPassed++;
        } else if (checkId === 'analyze') {
          run.analyze = await analyzeCodeAsync(config, root, {
            scan: run.scan ?? undefined,
            signal,
            onProgress: (event) => progress(checkId, event)
          });
          if (signal?.aborted) return cancelRun();
          run.scan ??= run.analyze.scan;
          const sev = run.analyze.bySeverity;
          const failed = sev.critical + sev.high > 0;
          step({
            type: failed ? 'failed' : 'done',
            check: checkId,
            message: `${run.analyze.findingCount} findings (critical ${sev.critical}, high ${sev.high}, medium ${sev.medium}, low ${sev.low}) across ${run.analyze.filesAnalyzed} files`,
            data: {
              filesAnalyzed: run.analyze.filesAnalyzed,
              linesAnalyzed: run.analyze.linesAnalyzed,
              findingCount: run.analyze.findingCount,
              bySeverity: sev,
              skipped: run.analyze.skipped.length,
              durationMs: run.analyze.durationMs
            }
          });
          failed ? run.checksFailed++ : run.checksPassed++;
        } else if (checkId === 'logs') {
          run.logs = analyzeLogs(config, root);
          const criticalCount = run.logs.signals.filter((signalEntry) => signalEntry.severity === 'critical').length;
          const logsData = {
            logsAnalyzed: run.logs.logsAnalyzed,
            linesRead: run.logs.linesRead,
            signalCount: run.logs.signals.length,
            criticalCount,
            blockerCount: run.logs.blockers.length,
            durationMs: run.logs.durationMs
          };
          if (run.logs.blockers.length > 0 && run.logs.logsAnalyzed === 0) {
            step({
              type: 'blocked',
              check: checkId,
              message: run.logs.blockers[0].message,
              data: { ...logsData, blockerCode: run.logs.blockers[0].code ?? null }
            });
            run.checksBlocked++;
          } else {
            const failed = criticalCount > 0;
            step({
              type: failed ? 'failed' : 'done',
              check: checkId,
              message: `Analyzed ${run.logs.logsAnalyzed} log file(s), ${run.logs.linesRead} lines — ${run.logs.signals.length} signal(s), ${criticalCount} critical`,
              data: logsData
            });
            failed ? run.checksFailed++ : run.checksPassed++;
          }
        } else if (checkId === 'regression') {
          step({
            type: 'done',
            check: checkId,
            message: 'Regression comparison requested — it runs when this report is persisted; the first persisted report becomes the baseline.',
            data: { comparison: 'deferred-to-report-persistence' }
          });
          run.checksPassed++;
        }
      } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError') return cancelRun();
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
        signal,
        onOutput: (text, isError) => notify({ at: nowIso(), type: 'output', check: checkId, stream: isError ? 'stderr' : 'stdout', message: text })
      });
      if (execution.cancelled || signal?.aborted) return cancelRun();
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
    if (signal?.aborted) return cancelRun();
    step({ type: 'running', check: 'custom-command', message: `$ ${cmd}` });
    const execution = await runCommand(cmd, {
      cwd: root,
      signal,
      onOutput: (text, isError) => notify({ at: nowIso(), type: 'output', check: 'custom-command', stream: isError ? 'stderr' : 'stdout', message: text })
    });
    if (execution.cancelled || signal?.aborted) return cancelRun();
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
  step({
    type: 'finish',
    check: null,
    message: `Profile "${profileName}" ${run.status}: ${run.checksPassed} passed, ${run.checksFailed} failed, ${run.checksBlocked} blocked, ${run.commandsExecuted} command(s) executed.`,
    data: runCounts(run)
  });
  return run;
}

function progressMessage(event) {
  const counts = event?.counts ?? {};
  const file = event?.currentFile ? ` - ${event.currentFile}` : '';
  if (event?.phase === 'scan') {
    if (event.stage === 'discover') return `Discovering files: ${counts.filesProcessed ?? 0}${file}`;
    if (event.stage === 'inventory') return `Inventory ${counts.filesProcessed ?? 0}/${counts.filesTotal ?? '?'} files, ${counts.sourceFiles ?? 0} source files${file}`;
    return `Scan complete: ${counts.filesProcessed ?? 0} files, ${counts.sourceFiles ?? 0} source files`;
  }
  if (event?.phase === 'analyze') {
    if (event.stage === 'rules') {
      return `Analyzing line ${event.currentLine ?? 0}/${event.currentFileLines ?? '?'}: ${counts.findings ?? 0} findings across ${counts.linesProcessed ?? 0} lines${file}`;
    }
    if (event.stage === 'skipped') return `Skipped unreadable, binary, or oversized source file${file}`;
    if (event.stage === 'complete') return `Analysis complete: ${counts.linesProcessed ?? 0} lines, ${counts.findings ?? 0} findings`;
    return `Analyzing ${counts.filesProcessed ?? 0}/${counts.filesTotal ?? '?'} source files${file}`;
  }
  return `Working${file}`;
}

function runCounts(run) {
  return {
    status: run.status,
    checksPassed: run.checksPassed,
    checksFailed: run.checksFailed,
    checksBlocked: run.checksBlocked,
    commandsExecuted: run.commandsExecuted,
    durationMs: run.durationMs ?? null
  };
}
