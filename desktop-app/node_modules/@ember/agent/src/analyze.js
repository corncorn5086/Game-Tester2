import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { LINE_RULES, FILE_RULES, compileCustomRule } from './rules.js';
import { scanProject, scanProjectAsync } from './scan.js';
import { maskSecrets, nowIso, throwIfAborted, yieldToEventLoop } from './util.js';

const MAX_FILE_BYTES = 1.5 * 1024 * 1024; // skip binaries / generated monsters
const MAX_FINDINGS_PER_RULE_PER_FILE = 5;
const DEFAULT_FILE_BATCH_SIZE = 8;
const DEFAULT_LINE_BATCH_SIZE = 500;

/**
 * Static code analysis over real project files. Every finding includes
 * file, line and the matched snippet as evidence - nothing is invented.
 */
export function analyzeCode(config, root, { scan } = {}) {
  const startedAt = Date.now();
  const scanResult = scan ?? scanProject(config, root);
  const rules = compileRules(config);
  const findings = [];
  let filesAnalyzed = 0;
  let linesAnalyzed = 0;
  const skipped = [];

  for (const file of scanResult.sourceFiles) {
    if (file.size > MAX_FILE_BYTES) {
      skipped.push({ path: file.path, reason: 'too large' });
      continue;
    }
    let content;
    try {
      content = readFileSync(file.abs, 'utf8');
    } catch {
      skipped.push({ path: file.path, reason: 'unreadable' });
      continue;
    }
    if (content.includes('\u0000')) {
      skipped.push({ path: file.path, reason: 'binary' });
      continue;
    }

    filesAnalyzed++;
    const lines = content.split('\n');
    linesAnalyzed += lines.length;
    const perRuleCount = {};
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      inspectLine({ lineIndex, lines, file, rules, perRuleCount, findings });
    }
    inspectFileRules({ content, file, findings });
  }

  return analysisResult({ startedAt, root, scanResult, findings, filesAnalyzed, linesAnalyzed, skipped });
}

/**
 * Cancellable static analysis for interactive runs. Work is split into real
 * file/line batches and yields with setImmediate; it never sleeps to simulate
 * activity. The returned analysis is equivalent to analyzeCode().
 */
export async function analyzeCodeAsync(config, root, {
  scan,
  signal,
  onProgress,
  fileBatchSize = DEFAULT_FILE_BATCH_SIZE,
  lineBatchSize = DEFAULT_LINE_BATCH_SIZE
} = {}) {
  const startedAt = Date.now();
  const emit = (stage, currentFile, counts, currentLine = null, currentFileLines = null) => {
    try {
      onProgress?.(progressEvent('analyze', stage, currentFile, counts, currentLine, currentFileLines));
    } catch { /* observers cannot interrupt analysis */ }
  };

  throwIfAborted(signal);
  const scanResult = scan ?? await scanProjectAsync(config, root, { signal, onProgress });
  throwIfAborted(signal);
  const rules = compileRules(config);
  const findings = [];
  const skipped = [];
  let filesAnalyzed = 0;
  let linesAnalyzed = 0;
  let bytesProcessed = 0;
  const filesTotal = scanResult.sourceFiles.length;
  const fileBatch = Math.max(1, fileBatchSize);
  const lineBatch = Math.max(1, lineBatchSize);

  emit('start', null, progressCounts({
    filesTotal,
    directoriesVisited: scanResult.dirsVisited,
    sourceFiles: scanResult.sourceFileCount
  }));
  throwIfAborted(signal);

  for (let fileIndex = 0; fileIndex < filesTotal; fileIndex++) {
    throwIfAborted(signal);
    const file = scanResult.sourceFiles[fileIndex];
    const filesProcessed = fileIndex + 1;
    if (fileIndex === 0 || filesProcessed % fileBatch === 0 || filesProcessed === filesTotal) {
      emit('read', file.path, progressCounts({
        filesProcessed,
        filesTotal,
        directoriesVisited: scanResult.dirsVisited,
        sourceFiles: scanResult.sourceFileCount,
        filesAnalyzed,
        bytesProcessed,
        linesProcessed: linesAnalyzed,
        findings: findings.length,
        skipped: skipped.length
      }));
      throwIfAborted(signal);
    }

    if (file.size > MAX_FILE_BYTES) {
      skipped.push({ path: file.path, reason: 'too large' });
      bytesProcessed += file.size;
      emitAnalyzeProgress({ emit, stage: 'skipped', file, filesProcessed, filesTotal, scanResult, filesAnalyzed, bytesProcessed, linesAnalyzed, findings, skipped });
      throwIfAborted(signal);
      continue;
    }

    let content;
    try {
      content = await readFile(file.abs, { encoding: 'utf8', signal });
    } catch {
      throwIfAborted(signal);
      skipped.push({ path: file.path, reason: 'unreadable' });
      bytesProcessed += file.size;
      emitAnalyzeProgress({ emit, stage: 'skipped', file, filesProcessed, filesTotal, scanResult, filesAnalyzed, bytesProcessed, linesAnalyzed, findings, skipped });
      continue;
    }
    throwIfAborted(signal);

    if (content.includes('\u0000')) {
      skipped.push({ path: file.path, reason: 'binary' });
      bytesProcessed += file.size;
      emitAnalyzeProgress({ emit, stage: 'skipped', file, filesProcessed, filesTotal, scanResult, filesAnalyzed, bytesProcessed, linesAnalyzed, findings, skipped });
      throwIfAborted(signal);
      continue;
    }

    filesAnalyzed++;
    const lines = content.split('\n');
    const linesBeforeFile = linesAnalyzed;
    const perRuleCount = {};
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      inspectLine({ lineIndex, lines, file, rules, perRuleCount, findings });
      const currentLine = lineIndex + 1;
      if (currentLine % lineBatch === 0 || currentLine === lines.length) {
        emit('rules', file.path, progressCounts({
          filesProcessed,
          filesTotal,
          directoriesVisited: scanResult.dirsVisited,
          sourceFiles: scanResult.sourceFileCount,
          filesAnalyzed,
          bytesProcessed,
          linesProcessed: linesBeforeFile + currentLine,
          findings: findings.length,
          skipped: skipped.length
        }), currentLine, lines.length);
        throwIfAborted(signal);
      }
      if (currentLine % lineBatch === 0) await yieldToEventLoop(signal);
    }

    throwIfAborted(signal);
    inspectFileRules({ content, file, findings });
    linesAnalyzed += lines.length;
    bytesProcessed += file.size;

    if (fileIndex === 0 || filesProcessed % fileBatch === 0 || filesProcessed === filesTotal) {
      emitAnalyzeProgress({
        emit,
        stage: 'file-complete',
        file,
        filesProcessed,
        filesTotal,
        scanResult,
        filesAnalyzed,
        bytesProcessed,
        linesAnalyzed,
        findings,
        skipped,
        currentLine: lines.length,
        currentFileLines: lines.length
      });
      throwIfAborted(signal);
    }
    if (filesProcessed % fileBatch === 0) await yieldToEventLoop(signal);
  }

  throwIfAborted(signal);
  const result = analysisResult({ startedAt, root, scanResult, findings, filesAnalyzed, linesAnalyzed, skipped });
  emit('complete', scanResult.sourceFiles.at(-1)?.path ?? null, progressCounts({
    filesProcessed: filesTotal,
    filesTotal,
    directoriesVisited: scanResult.dirsVisited,
    sourceFiles: scanResult.sourceFileCount,
    filesAnalyzed,
    bytesProcessed,
    linesProcessed: linesAnalyzed,
    findings: findings.length,
    skipped: skipped.length
  }));
  throwIfAborted(signal);
  return result;
}

function emitAnalyzeProgress({
  emit,
  stage,
  file,
  filesProcessed,
  filesTotal,
  scanResult,
  filesAnalyzed,
  bytesProcessed,
  linesAnalyzed,
  findings,
  skipped,
  currentLine = null,
  currentFileLines = null
}) {
  emit(stage, file.path, progressCounts({
    filesProcessed,
    filesTotal,
    directoriesVisited: scanResult.dirsVisited,
    sourceFiles: scanResult.sourceFileCount,
    filesAnalyzed,
    bytesProcessed,
    linesProcessed: linesAnalyzed,
    findings: findings.length,
    skipped: skipped.length
  }), currentLine, currentFileLines);
}

function compileRules(config) {
  const customRules = (config?.customRules ?? []).map((rule) => {
    try {
      return compileCustomRule(rule);
    } catch {
      return null;
    }
  }).filter(Boolean);
  return [...LINE_RULES, ...customRules];
}

function inspectLine({ lineIndex, lines, file, rules, perRuleCount, findings }) {
  const line = lines[lineIndex];
  if (line.length > 2000) return;

  for (const rule of rules) {
    if (rule.extensions && !rule.extensions.includes(file.ext)) continue;
    if ((perRuleCount[rule.id] ?? 0) >= MAX_FINDINGS_PER_RULE_PER_FILE) continue;
    if (!rule.pattern.test(line)) continue;

    let message = rule.message;
    if (rule.refine) {
      const window = lines.slice(lineIndex, lineIndex + 25).join('\n');
      if (rule.refine(line, window)) {
        message = rule.refineMessage ?? message;
      } else {
        continue;
      }
    }

    perRuleCount[rule.id] = (perRuleCount[rule.id] ?? 0) + 1;
    findings.push({
      ruleId: rule.id,
      severity: rule.severity,
      category: rule.category,
      message: maskSecrets(message),
      suggest: maskSecrets(rule.suggest ?? ''),
      file: file.path,
      line: lineIndex + 1,
      evidence: maskSecrets(line.trim().slice(0, 240))
    });
  }
}

function inspectFileRules({ content, file, findings }) {
  for (const rule of FILE_RULES) {
    const hit = rule.check(content, file);
    if (!hit) continue;
    findings.push({
      ruleId: rule.id,
      severity: rule.severity,
      category: rule.category,
      message: maskSecrets(rule.message),
      suggest: maskSecrets(rule.suggest ?? ''),
      file: file.path,
      line: hit.line,
      evidence: maskSecrets(hit.detail)
    });
  }
}

function analysisResult({ startedAt, root, scanResult, findings, filesAnalyzed, linesAnalyzed, skipped }) {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;

  return {
    kind: 'analyze',
    analyzedAt: nowIso(),
    durationMs: Date.now() - startedAt,
    root,
    filesAnalyzed,
    linesAnalyzed,
    skipped: skipped.slice(0, 50),
    findingCount: findings.length,
    bySeverity,
    findings: findings.sort((a, b) => sevRank(a.severity) - sevRank(b.severity)),
    suggestedTests: deriveSuggestedTests(findings, scanResult),
    scan: scanResult
  };
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

function sevRank(severity) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[severity] ?? 4;
}

function deriveSuggestedTests(findings, scan) {
  const suggestions = [];
  const has = (ruleId) => findings.some((finding) => finding.ruleId === ruleId);

  if (has('js-localstorage-parse') || has('unity-playerprefs-save') || has('save-system-no-error-handling')) {
    suggestions.push({ check: 'save-load', reason: 'Save/persistence code paths detected with weak validation - add save/load round-trip tests including corrupted-save cases.' });
  }
  if (has('unity-oncollision-null')) {
    suggestions.push({ check: 'collision', reason: 'Collision handlers found - add tests that destroy objects mid-collision.' });
  }
  if (has('unity-getcomponent-update') || has('unreal-tick-heavy') || has('godot-get-node-process') || has('js-settimeout-gameloop')) {
    suggestions.push({ check: 'performance', reason: 'Per-frame hot paths flagged - add frame-time regression checks.' });
  }
  if (has('random-seed-time')) {
    suggestions.push({ check: 'input-fuzzing', reason: 'Non-deterministic RNG in gameplay code - fuzz with fixed seeds to make failures reproducible.' });
  }
  if (findings.some((finding) => finding.category === 'crash')) {
    suggestions.push({ check: 'regression', reason: 'Crash-prone patterns present - re-run analysis after fixes to verify they stay fixed.' });
  }
  if (scan.filesScanned > 0 && suggestions.length === 0) {
    suggestions.push({ check: 'analyze', reason: 'No high-signal patterns detected - keep static analysis in your smoke profile to catch regressions early.' });
  }
  return suggestions;
}
