import { walkFiles, nowIso } from './util.js';
import { detectEngine } from './detect.js';

/**
 * Scan the project: walk files, detect engine, inventory by extension,
 * flag oversized files and locate config/log/crash folders that exist.
 * Everything reported here is measured, not invented.
 */
export function scanProject(config, root) {
  const startedAt = Date.now();
  const { files, truncated, dirsVisited } = walkFiles(root, {
    ignorePaths: config?.ignorePaths ?? [],
    maxFiles: config?.maxFiles ?? 5000
  });

  const byExtension = {};
  let totalBytes = 0;
  for (const f of files) {
    totalBytes += f.size;
    const key = f.ext || '(none)';
    byExtension[key] = (byExtension[key] ?? 0) + 1;
  }

  const detection = detectEngine(root);

  const include = new Set(config?.includeExtensions ?? []);
  const exclude = new Set(config?.excludeExtensions ?? []);
  const sourceFiles = files.filter((f) => (include.size ? include.has(f.ext) : true) && !exclude.has(f.ext));

  const largeFiles = files
    .filter((f) => f.size > 5 * 1024 * 1024)
    .sort((a, b) => b.size - a.size)
    .slice(0, 20)
    .map(({ path, size }) => ({ path, size }));

  return {
    kind: 'scan',
    scannedAt: nowIso(),
    durationMs: Date.now() - startedAt,
    root,
    engineDetection: detection,
    configuredEngine: config?.engine ?? null,
    filesScanned: files.length,
    sourceFileCount: sourceFiles.length,
    dirsVisited,
    totalBytes,
    truncated,
    byExtension: Object.fromEntries(Object.entries(byExtension).sort((a, b) => b[1] - a[1])),
    largeFiles,
    sourceFiles: sourceFiles.map(({ path, abs, size, ext }) => ({ path, abs, size, ext }))
  };
}
