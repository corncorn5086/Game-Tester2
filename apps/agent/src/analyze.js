import { readFileSync } from 'node:fs';
import { LINE_RULES, FILE_RULES, compileCustomRule } from './rules.js';
import { scanProject } from './scan.js';
import { nowIso } from './util.js';

const MAX_FILE_BYTES = 1.5 * 1024 * 1024; // skip binaries / generated monsters
const MAX_FINDINGS_PER_RULE_PER_FILE = 5;

/**
 * Static code analysis over real project files. Every finding includes
 * file, line and the matched snippet as evidence — nothing is invented.
 */
export function analyzeCode(config, root, { scan } = {}) {
  const startedAt = Date.now();
  const scanResult = scan ?? scanProject(config, root);

  const customRules = (config?.customRules ?? []).map((r) => {
    try {
      return compileCustomRule(r);
    } catch {
      return null;
    }
  }).filter(Boolean);
  const rules = [...LINE_RULES, ...customRules];

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
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 2000) continue;
      for (const rule of rules) {
        if (rule.extensions && !rule.extensions.includes(file.ext)) continue;
        if ((perRuleCount[rule.id] ?? 0) >= MAX_FINDINGS_PER_RULE_PER_FILE) continue;
        if (!rule.pattern.test(line)) continue;

        let message = rule.message;
        let severity = rule.severity;
        if (rule.refine) {
          const window = lines.slice(i, i + 25).join('\n');
          if (rule.refine(line, window)) {
            message = rule.refineMessage ?? message;
          } else {
            continue; // refine gate not met → skip noisy base match
          }
        }
        perRuleCount[rule.id] = (perRuleCount[rule.id] ?? 0) + 1;
        findings.push({
          ruleId: rule.id,
          severity,
          category: rule.category,
          message,
          suggest: rule.suggest,
          file: file.path,
          line: i + 1,
          evidence: line.trim().slice(0, 240)
        });
      }
    }

    for (const rule of FILE_RULES) {
      const hit = rule.check(content, file);
      if (hit) {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity,
          category: rule.category,
          message: rule.message,
          suggest: rule.suggest,
          file: file.path,
          line: hit.line,
          evidence: hit.detail
        });
      }
    }
  }

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;

  // Suggested tests derived from what the code actually contains
  const suggestedTests = deriveSuggestedTests(findings, scanResult);

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
    suggestedTests,
    scan: scanResult
  };
}

function sevRank(s) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[s] ?? 4;
}

function deriveSuggestedTests(findings, scan) {
  const suggestions = [];
  const has = (ruleId) => findings.some((f) => f.ruleId === ruleId);

  if (has('js-localstorage-parse') || has('unity-playerprefs-save') || has('save-system-no-error-handling')) {
    suggestions.push({ check: 'save-load', reason: 'Save/persistence code paths detected with weak validation — add save/load round-trip tests including corrupted-save cases.' });
  }
  if (has('unity-oncollision-null')) {
    suggestions.push({ check: 'collision', reason: 'Collision handlers found — add tests that destroy objects mid-collision.' });
  }
  if (has('unity-getcomponent-update') || has('unreal-tick-heavy') || has('godot-get-node-process') || has('js-settimeout-gameloop')) {
    suggestions.push({ check: 'performance', reason: 'Per-frame hot paths flagged — add frame-time regression checks.' });
  }
  if (has('random-seed-time')) {
    suggestions.push({ check: 'input-fuzzing', reason: 'Non-deterministic RNG in gameplay code — fuzz with fixed seeds to make failures reproducible.' });
  }
  if (findings.some((f) => f.category === 'crash')) {
    suggestions.push({ check: 'regression', reason: 'Crash-prone patterns present — re-run analysis after fixes to verify they stay fixed.' });
  }
  if (scan.filesScanned > 0 && suggestions.length === 0) {
    suggestions.push({ check: 'analyze', reason: 'No high-signal patterns detected — keep static analysis in your smoke profile to catch regressions early.' });
  }
  return suggestions;
}
