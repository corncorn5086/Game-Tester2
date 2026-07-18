import { maskSecrets, walkFiles, walkFilesAsync, nowIso, throwIfAborted, yieldToEventLoop } from './util.js';
import { detectEngine } from './detect.js';

const DEFAULT_SCAN_BATCH_SIZE = 24;

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

/**
 * Cancellable, event-loop-friendly project scan used by interactive runs.
 * onProgress receives measured counters only; no timer-based progress is used.
 */
export async function scanProjectAsync(config, root, {
  signal,
  onProgress,
  batchSize = DEFAULT_SCAN_BATCH_SIZE
} = {}) {
  const startedAt = Date.now();
  const include = new Set(config?.includeExtensions ?? []);
  const exclude = new Set(config?.excludeExtensions ?? []);
  let sourceFilesSeen = 0;

  const emit = (stage, currentFile, counts) => {
    const event = progressEvent('scan', stage, currentFile, counts);
    try { onProgress?.(event); } catch { /* observers cannot interrupt the scan */ }
  };

  emit('discover', null, progressCounts());
  const walked = await walkFilesAsync(root, {
    ignorePaths: config?.ignorePaths ?? [],
    maxFiles: config?.maxFiles ?? 5000,
    batchSize,
    signal,
    onProgress: ({ currentFile, filesDiscovered, dirsVisited, bytesDiscovered }) => {
      emit('discover', currentFile, progressCounts({
        filesProcessed: filesDiscovered,
        filesTotal: null,
        directoriesVisited: dirsVisited,
        bytesProcessed: bytesDiscovered
      }));
    }
  });
  throwIfAborted(signal);

  const byExtension = {};
  let totalBytes = 0;
  const sourceFiles = [];
  const size = Math.max(1, batchSize);
  for (let i = 0; i < walked.files.length; i++) {
    throwIfAborted(signal);
    const file = walked.files[i];
    totalBytes += file.size;
    const key = file.ext || '(none)';
    byExtension[key] = (byExtension[key] ?? 0) + 1;
    if ((include.size ? include.has(file.ext) : true) && !exclude.has(file.ext)) {
      sourceFiles.push(file);
      sourceFilesSeen++;
    }

    const processed = i + 1;
    if (i === 0 || processed % size === 0 || processed === walked.files.length) {
      emit('inventory', file.path, progressCounts({
        filesProcessed: processed,
        filesTotal: walked.files.length,
        directoriesVisited: walked.dirsVisited,
        sourceFiles: sourceFilesSeen,
        bytesProcessed: totalBytes
      }));
    }
    if (processed % size === 0) await yieldToEventLoop(signal);
  }

  throwIfAborted(signal);
  const detection = detectEngine(root);
  const largeFiles = walked.files
    .filter((f) => f.size > 5 * 1024 * 1024)
    .sort((a, b) => b.size - a.size)
    .slice(0, 20)
    .map(({ path, size: fileSize }) => ({ path, size: fileSize }));

  const result = {
    kind: 'scan',
    scannedAt: nowIso(),
    durationMs: Date.now() - startedAt,
    root,
    engineDetection: detection,
    configuredEngine: config?.engine ?? null,
    filesScanned: walked.files.length,
    sourceFileCount: sourceFiles.length,
    dirsVisited: walked.dirsVisited,
    totalBytes,
    truncated: walked.truncated,
    byExtension: Object.fromEntries(Object.entries(byExtension).sort((a, b) => b[1] - a[1])),
    largeFiles,
    sourceFiles: sourceFiles.map(({ path, abs, size: fileSize, ext }) => ({ path, abs, size: fileSize, ext }))
  };

  emit('complete', sourceFiles.at(-1)?.path ?? walked.files.at(-1)?.path ?? null, progressCounts({
    filesProcessed: result.filesScanned,
    filesTotal: result.filesScanned,
    directoriesVisited: result.dirsVisited,
    sourceFiles: result.sourceFileCount,
    bytesProcessed: result.totalBytes
  }));
  throwIfAborted(signal);
  return result;
}

function progressCounts(overrides = {}) {
  return {
    filesProcessed: 0,
    filesTotal: null,
    directoriesVisited: 0,
    sourceFiles: 0,
    filesAnalyzed: 0,
    bytesProcessed: 0,
    linesProcessed: 0,
    findings: 0,
    skipped: 0,
    ...overrides
  };
}

function progressEvent(phase, stage, currentFile, counts, currentLine = null, currentFileLines = null) {
  return {
    phase,
    stage,
    currentFile: currentFile ? maskSecrets(currentFile) : null,
    currentLine,
    currentFileLines,
    counts
  };
}
