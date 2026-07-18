import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { ENGINES } from '@ember/shared/engines';
import { maskSecrets, nowIso } from './util.js';

const MAX_LOG_BYTES = 8 * 1024 * 1024;
const MAX_LOG_FILES = 40;
const CONTEXT_LINES = 4;

/**
 * Parse real log files for crash/error signals using the engine's
 * known error patterns. Returns explicit blockers when logs are not
 * configured or the folder does not exist — never fabricated entries.
 */
export function analyzeLogs(config, root) {
  const startedAt = Date.now();
  const result = {
    kind: 'logs',
    analyzedAt: nowIso(),
    durationMs: 0,
    logsAnalyzed: 0,
    linesRead: 0,
    signals: [],
    blockers: [],
    files: []
  };

  const engine = ENGINES[config?.engine] ?? ENGINES.custom;
  const patterns = engine.logs.errorPatterns.map((p) => ({ ...p, re: new RegExp(p.pattern, 'i') }));

  if (!config?.logsPath) {
    result.blockers.push({ code: 'logs-path-missing', message: `No logsPath configured. ${engine.logs.hint}` });
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const logsDir = isAbsolute(config.logsPath) ? config.logsPath : resolve(root, config.logsPath);
  if (!existsSync(logsDir)) {
    result.blockers.push({ code: 'logs-folder-not-found', message: `Logs path not found: ${logsDir}. ${engine.logs.hint}` });
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  // Collect files: logsPath may be a single file or a folder
  let logFiles = [];
  const st = statSync(logsDir);
  if (st.isFile()) {
    logFiles = [logsDir];
  } else {
    try {
      logFiles = readdirSync(logsDir)
        .filter((f) => /\.(log|txt|out|err|json)$/i.test(f) || f.toLowerCase().includes('log'))
        .map((f) => join(logsDir, f))
        .filter((f) => {
          try {
            return statSync(f).isFile();
          } catch {
            return false;
          }
        })
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
        .slice(0, MAX_LOG_FILES);
    } catch (e) {
      result.blockers.push({ code: 'logs-unreadable', message: `Cannot read logs folder: ${e.message}` });
    }
  }

  if (logFiles.length === 0 && result.blockers.length === 0) {
    result.blockers.push({ code: 'logs-empty', message: `Logs folder exists but contains no log files: ${logsDir}` });
  }

  for (const file of logFiles) {
    let content;
    try {
      const size = statSync(file).size;
      content = readFileSync(file, 'utf8');
      if (size > MAX_LOG_BYTES) content = content.slice(-MAX_LOG_BYTES); // tail the newest part
    } catch {
      continue;
    }
    const lines = content.split('\n');
    result.logsAnalyzed++;
    result.linesRead += lines.length;
    result.files.push({ path: file, lines: lines.length });

    const seen = new Map(); // dedupe identical signals per file
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const p of patterns) {
        if (!p.re.test(line)) continue;
        const key = `${p.label}:${line.trim().slice(0, 120)}`;
        const existing = seen.get(key);
        if (existing) {
          existing.occurrences++;
          existing.lastLine = i + 1;
          continue;
        }
        const signal = {
          label: p.label,
          severity: p.severity,
          category: p.category,
          file,
          firstLine: i + 1,
          lastLine: i + 1,
          occurrences: 1,
          evidence: maskSecrets(line.trim().slice(0, 300)),
          context: lines.slice(Math.max(0, i - 1), i + CONTEXT_LINES).map((l) => maskSecrets(l.slice(0, 300)))
        };
        seen.set(key, signal);
        result.signals.push(signal);
        break; // one pattern per line is enough
      }
    }
  }

  // Crash reports folder, if configured
  if (config.crashReportsPath) {
    const crashDir = isAbsolute(config.crashReportsPath) ? config.crashReportsPath : resolve(root, config.crashReportsPath);
    if (existsSync(crashDir)) {
      try {
        const dumps = readdirSync(crashDir).filter((f) => /\.(dmp|crash|txt|log|json)$/i.test(f));
        result.crashReports = { path: crashDir, count: dumps.length, files: dumps.slice(0, 20) };
        if (dumps.length > 0) {
          result.signals.push({
            label: 'Crash dumps present',
            severity: 'critical',
            category: 'crash',
            file: crashDir,
            firstLine: 0,
            lastLine: 0,
            occurrences: dumps.length,
            evidence: `${dumps.length} crash report file(s) in ${config.crashReportsPath}`,
            context: dumps.slice(0, 5)
          });
        }
      } catch { /* crash dir unreadable — skip, logs blockers already explain state */ }
    } else {
      result.blockers.push({ code: 'crash-reports-folder-not-found', message: `Crash reports path not found: ${crashDir}` });
    }
  }

  result.signals.sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
  result.durationMs = Date.now() - startedAt;
  return result;
}

function sevRank(s) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[s] ?? 4;
}
