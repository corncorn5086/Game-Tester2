import { readdirSync, statSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const TTY = process.stdout.isTTY;
const wrap = (code) => (s) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  orange: wrap('38;5;208'),
  cyan: wrap('36'),
  gray: wrap('90')
};

export const EMBER_MARK = c.orange('◆ ember');

export function log(msg = '') {
  console.log(msg);
}

export function sevColor(severity) {
  return { critical: c.red, high: c.orange, medium: c.yellow, low: c.gray }[severity] ?? c.gray;
}

const ALWAYS_IGNORE = new Set(['.git', 'node_modules', '.ember']);

/**
 * Walk a directory tree collecting files, honoring ignore lists and a max count.
 * @returns {{ files: {path:string, size:number, ext:string}[], truncated: boolean, dirsVisited: number }}
 */
export function walkFiles(root, { ignorePaths = [], maxFiles = 5000 } = {}) {
  const ignore = new Set([...ALWAYS_IGNORE, ...ignorePaths.map((p) => p.replace(/[/\\]+$/, ''))]);
  const files = [];
  let truncated = false;
  let dirsVisited = 0;

  const visit = (dir) => {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }
    dirsVisited++;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (ignore.has(entry.name) || ignore.has(rel) || rel.split(sep).some((part) => ignore.has(part))) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        let size = 0;
        try {
          size = statSync(full).size;
        } catch {
          continue;
        }
        const dot = entry.name.lastIndexOf('.');
        files.push({ path: rel, abs: full, size, ext: dot >= 0 ? entry.name.slice(dot).toLowerCase() : '' });
      }
    }
  };

  visit(root);
  return { files, truncated, dirsVisited };
}

/**
 * Event-loop-friendly counterpart to walkFiles(). Directory reads and stats are
 * asynchronous, progress is emitted in bounded batches, and cancellation is
 * checked between every filesystem operation. It intentionally keeps the
 * synchronous API above for existing CLI/programmatic callers.
 */
export async function walkFilesAsync(root, {
  ignorePaths = [],
  maxFiles = 5000,
  batchSize = 24,
  signal,
  onProgress
} = {}) {
  const ignore = new Set([...ALWAYS_IGNORE, ...ignorePaths.map((p) => p.replace(/[/\\]+$/, ''))]);
  const files = [];
  let truncated = false;
  let dirsVisited = 0;
  let bytesDiscovered = 0;
  let filesSinceYield = 0;

  const emit = (currentFile) => {
    try {
      onProgress?.({
        currentFile,
        filesDiscovered: files.length,
        dirsVisited,
        bytesDiscovered
      });
    } catch { /* telemetry listeners must never stop a real scan */ }
  };

  const visit = async (dir) => {
    throwIfAborted(signal);
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }
    dirsVisited++;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      throwIfAborted(signal);
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }

      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (ignore.has(entry.name) || ignore.has(rel) || rel.split(sep).some((part) => ignore.has(part))) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;

      let size = 0;
      try {
        size = (await stat(full)).size;
      } catch {
        continue;
      }
      const dot = entry.name.lastIndexOf('.');
      files.push({ path: rel, abs: full, size, ext: dot >= 0 ? entry.name.slice(dot).toLowerCase() : '' });
      bytesDiscovered += size;
      filesSinceYield++;

      if (filesSinceYield >= Math.max(1, batchSize)) {
        emit(rel);
        filesSinceYield = 0;
        await yieldToEventLoop(signal);
      }
    }
  };

  await visit(root);
  throwIfAborted(signal);
  if (filesSinceYield > 0 || files.length === 0) emit(files.at(-1)?.path ?? null);
  throwIfAborted(signal);
  return { files, truncated, dirsVisited };
}

/**
 * Mask likely secrets before storing, displaying or sending text to an AI.
 * Trusted callers may provide exact credential values as a second safety net;
 * those values are replaced literally and are never returned.
 */
export function maskSecrets(line, secretValues = []) {
  let masked = String(line ?? '');
  const exactSecrets = [...new Set((Array.isArray(secretValues) ? secretValues : [secretValues])
    .filter((value) => typeof value === 'string' && value.length >= 8))]
    .sort((a, b) => b.length - a.length);
  for (const secret of exactSecrets) masked = masked.split(secret).join('***MASKED***');
  return masked
    .replace(/(api[_-]?key|secret|token|password|passwd|authorization|bearer)(["'\s:=]+)([^\s,"'};]{8,})/gi, '$1$2***MASKED***')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/gi, 'sk-***MASKED***')
    .replace(/(sk_live_|sk_test_|pk_live_)[A-Za-z0-9]{8,}/g, '$1***MASKED***')
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, 'gh_***MASKED***')
    .replace(/AKIA[0-9A-Z]{16}/g, 'AKIA***MASKED***')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '***MASKED_JWT***');
}

/** Recursively mask text before it becomes telemetry or a persisted run artifact. */
export function maskSensitive(value) {
  if (typeof value === 'string') return maskSecrets(value);
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (!value || typeof value !== 'object') return value;

  const masked = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(?:api[_-]?key|secret|password|passwd|authorization|access[_-]?token|refresh[_-]?token)$/i.test(key)) {
      masked[key] = item == null ? item : '***MASKED***';
    } else {
      masked[key] = maskSensitive(item);
    }
  }
  return masked;
}

export function abortError(signal) {
  const reason = signal?.reason;
  const message = reason instanceof Error ? reason.message : reason ? String(reason) : 'Operation cancelled';
  const error = new Error(maskSecrets(message));
  error.name = 'AbortError';
  return error;
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

/** Yield without sleeping; this only gives cancellation/UI events a chance to run. */
export async function yieldToEventLoop(signal) {
  throwIfAborted(signal);
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  throwIfAborted(signal);
}

export function humanBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function nowIso() {
  return new Date().toISOString();
}
