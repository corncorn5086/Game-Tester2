import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINES } from '@ember/shared/engines';

/**
 * Detect the engine/project type of a directory from real markers
 * (folders, marker files, package.json contents).
 * @returns {{ engine: string, confidence: 'high'|'medium'|'low', evidence: string[] }}
 */
export function detectEngine(root) {
  const evidence = [];

  const has = (p) => existsSync(join(root, p));

  // Unity: Assets + ProjectSettings
  if (has('Assets') && has('ProjectSettings')) {
    evidence.push('Found Assets/ and ProjectSettings/ folders');
    if (has('ProjectSettings/ProjectVersion.txt')) {
      try {
        const v = readFileSync(join(root, 'ProjectSettings/ProjectVersion.txt'), 'utf8').match(/m_EditorVersion:\s*(\S+)/);
        if (v) evidence.push(`Unity editor version ${v[1]}`);
      } catch { /* version file unreadable — folder markers are enough */ }
    }
    return { engine: 'unity', confidence: 'high', evidence };
  }

  // Unreal: *.uproject
  let entries = [];
  try {
    entries = readdirSync(root);
  } catch { /* unreadable root — fall through to low-confidence result */ }
  const uproject = entries.find((f) => f.endsWith('.uproject'));
  if (uproject) {
    evidence.push(`Found ${uproject}`);
    return { engine: 'unreal', confidence: 'high', evidence };
  }

  // Godot: project.godot
  if (has('project.godot')) {
    evidence.push('Found project.godot');
    return { engine: 'godot', confidence: 'high', evidence };
  }

  // Web: package.json with a known game framework
  if (has('package.json')) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const hints = ENGINES.web.detect.packageHints.filter((h) => deps?.[h]);
      if (hints.length) {
        evidence.push(`package.json depends on ${hints.join(', ')}`);
        return { engine: 'web', confidence: 'high', evidence };
      }
      evidence.push('Found package.json (no known game framework dependency)');
      return { engine: 'web', confidence: 'medium', evidence };
    } catch {
      evidence.push('Found package.json (unparseable)');
    }
  }

  // Generic native project markers
  for (const marker of ['CMakeLists.txt', 'Makefile', 'Cargo.toml', 'build.gradle']) {
    if (has(marker)) {
      evidence.push(`Found ${marker}`);
      return { engine: 'custom', confidence: 'medium', evidence };
    }
  }

  evidence.push('No engine markers found');
  return { engine: 'custom', confidence: 'low', evidence };
}
