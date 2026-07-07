import { readdirSync, statSync } from 'node:fs';
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

/** Mask likely secrets in a text line before storing/uploading it. */
export function maskSecrets(line) {
  return line
    .replace(/(api[_-]?key|secret|token|password|passwd|authorization|bearer)(["'\s:=]+)([A-Za-z0-9\-_./+]{8,})/gi, '$1$2***MASKED***')
    .replace(/sk-[A-Za-z0-9]{16,}/g, 'sk-***MASKED***')
    .replace(/(sk_live_|sk_test_|pk_live_)[A-Za-z0-9]{8,}/g, '$1***MASKED***')
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, 'gh_***MASKED***')
    .replace(/AKIA[0-9A-Z]{16}/g, 'AKIA***MASKED***')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '***MASKED_JWT***');
}

export function humanBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function nowIso() {
  return new Date().toISOString();
}
