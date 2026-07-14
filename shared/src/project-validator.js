/**
 * ProjectValidator — strict validation that a folder really is a game or
 * code project BEFORE Ember connects to it, writes ember.config.json into
 * it, scans it or reports on it.
 *
 * Every rule here exists because the product must never fabricate results:
 * pointing Ember at C:\, an empty folder or a Photos directory must fail
 * loudly with reasons — never produce a scan, a report or a "completed" run.
 *
 * Node-only (fs access). Used by the agent CLI, the Electron main process
 * and the backend (when the path is reachable from the backend host).
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join, parse as parsePath, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { ENGINES } from './engines.js';

/** Directory names that must never be accepted as a project root. */
export const FORBIDDEN_ROOT_NAMES = new Set([
  'node_modules', 'library', 'temp', 'tmp', 'binaries', 'intermediate',
  'deriveddatacache', 'saved', '.git', '.svn', '.hg', 'dist', 'build',
  'out', 'target', 'obj', 'bin', '.cache', 'cache', 'caches', '.godot',
  '.import', '__pycache__', '.venv', 'venv'
]);

/** Well-known user folders that are never a game project root by themselves. */
const USER_MEDIA_DIRS = new Set([
  'downloads', 'desktop', 'documents', 'pictures', 'photos', 'music',
  'videos', 'movies', 'appdata', 'application data', 'onedrive'
]);

/** Absolute paths (normalized, lowercased) that are always refused. */
function isDangerousSystemRoot(absPath) {
  const p = absPath.replace(/[\\/]+$/, '');
  const { root } = parsePath(p);
  if (p === root.replace(/[\\/]+$/, '') || p === '') return true; // drive/filesystem root
  const lower = p.toLowerCase();
  const home = homedir().replace(/[\\/]+$/, '');
  if (lower === home.toLowerCase()) return true; // entire user profile
  const winDanger = [':\\windows', ':\\program files', ':\\program files (x86)', ':\\programdata', ':\\$recycle.bin', ':\\system volume information'];
  if (winDanger.some((d) => lower.endsWith(d) || lower.includes(d + '\\'))) return true;
  const nixDanger = ['/system', '/usr', '/etc', '/var', '/bin', '/sbin', '/lib', '/boot', '/proc', '/sys', '/dev', '/opt', '/private'];
  if (nixDanger.some((d) => lower === d)) return true;
  return false;
}

const SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.js', '.mjs', '.cjs', '.ts',
  '.tsx', '.jsx', '.gd', '.rs', '.py', '.lua', '.java', '.kt', '.go',
  '.swift', '.shader', '.hlsl', '.glsl', '.uc', '.uplugin', '.asmdef'
]);
const MANIFEST_FILES = new Set([
  'package.json', 'cargo.toml', 'cmakelists.txt', 'makefile', 'build.gradle',
  'settings.gradle', 'pyproject.toml', 'go.mod', 'gemfile', 'composer.json'
]);
const MEDIA_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.raw', '.svg',
  '.mp3', '.wav', '.ogg', '.flac', '.mp4', '.mov', '.avi', '.mkv',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.zip', '.rar', '.7z'
]);

/**
 * Shallow inventory of a folder (depth-limited, entry-limited) — enough to
 * decide whether real source/config lives here without walking a huge tree.
 */
function inventory(root, { maxDepth = 3, maxEntries = 4000 } = {}) {
  const counts = { source: 0, manifest: 0, media: 0, other: 0, dirs: 0, total: 0 };
  const sourceSamples = [];
  const walk = (dir, depth) => {
    if (counts.total >= maxEntries) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (counts.total >= maxEntries) return;
      counts.total++;
      const name = e.name.toLowerCase();
      if (e.isDirectory()) {
        counts.dirs++;
        if (FORBIDDEN_ROOT_NAMES.has(name)) continue; // never descend into caches/builds
        if (depth < maxDepth) walk(join(dir, e.name), depth + 1);
      } else if (e.isFile()) {
        const dot = name.lastIndexOf('.');
        const ext = dot === -1 ? '' : name.slice(dot);
        if (MANIFEST_FILES.has(name)) counts.manifest++;
        else if (SOURCE_EXTENSIONS.has(ext)) {
          counts.source++;
          if (sourceSamples.length < 5) sourceSamples.push(join(dir, e.name).slice(root.length + 1));
        } else if (MEDIA_EXTENSIONS.has(ext)) counts.media++;
        else counts.other++;
      }
    }
  };
  walk(root, 0);
  return { counts, sourceSamples };
}

/** Engine detection from real markers — mirrors agent detection, shared here. */
function detectEngineMarkers(root) {
  const evidence = [];
  const has = (p) => existsSync(join(root, p));

  if (has('Assets') && has('ProjectSettings')) {
    evidence.push('Assets/ and ProjectSettings/ folders present');
    if (has('ProjectSettings/ProjectVersion.txt')) {
      try {
        const v = readFileSync(join(root, 'ProjectSettings/ProjectVersion.txt'), 'utf8').match(/m_EditorVersion:\s*(\S+)/);
        if (v) evidence.push(`ProjectSettings/ProjectVersion.txt → Unity ${v[1]}`);
        return { engine: 'unity', confidence: 'high', evidence, projectType: 'game' };
      } catch { /* marker folders alone are medium confidence */ }
    }
    return { engine: 'unity', confidence: 'medium', evidence, projectType: 'game' };
  }

  let entries = [];
  try { entries = readdirSync(root); } catch { /* unreadable → handled by caller */ }
  const uproject = entries.find((f) => f.endsWith('.uproject'));
  if (uproject) {
    evidence.push(`${uproject} present`);
    const support = ['Content', 'Source', 'Config'].filter((d) => has(d));
    if (support.length) {
      evidence.push(`${support.join('/, ')}/ folder(s) present`);
      return { engine: 'unreal', confidence: 'high', evidence, projectType: 'game' };
    }
    return { engine: 'unreal', confidence: 'medium', evidence, projectType: 'game' };
  }

  if (has('project.godot')) {
    evidence.push('project.godot present');
    const scenes = entries.filter((f) => f.endsWith('.tscn') || f.endsWith('.gd')).length;
    if (scenes > 0) evidence.push(`${scenes} Godot scene/script file(s) at root`);
    return { engine: 'godot', confidence: scenes > 0 ? 'high' : 'medium', evidence, projectType: 'game' };
  }

  if (has('package.json')) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const hints = (ENGINES.web.detect.packageHints ?? []).filter((h) => deps?.[h]);
      if (hints.length) {
        evidence.push(`package.json depends on ${hints.join(', ')}`);
        return { engine: 'web', confidence: 'high', evidence, projectType: 'game' };
      }
      if (pkg.name || pkg.scripts) {
        evidence.push('package.json with scripts/name (no game framework dependency)');
        return { engine: 'web', confidence: 'medium', evidence, projectType: 'code' };
      }
      evidence.push('package.json present but empty of name/scripts');
    } catch {
      evidence.push('package.json present but unparseable');
      return { engine: null, confidence: 'none', evidence, projectType: 'unknown' };
    }
  }

  for (const marker of ['CMakeLists.txt', 'Makefile', 'Cargo.toml', 'build.gradle', 'go.mod', 'pyproject.toml']) {
    if (has(marker)) {
      evidence.push(`${marker} present`);
      return { engine: 'custom', confidence: 'medium', evidence, projectType: 'code' };
    }
  }
  const solution = entries.find((f) => f.endsWith('.sln') || f.endsWith('.csproj'));
  if (solution) {
    evidence.push(`${solution} present`);
    return { engine: 'custom', confidence: 'medium', evidence, projectType: 'code' };
  }

  return { engine: null, confidence: 'none', evidence, projectType: 'unknown' };
}

/**
 * Validate that `inputPath` is a real, safe game/code project root.
 *
 * @returns {{
 *   valid: boolean,
 *   projectType: 'game'|'code'|'unknown',
 *   engine: string|null,
 *   confidence: 'high'|'medium'|'low'|'none',
 *   evidence: string[],
 *   warnings: string[],
 *   errors: string[],
 *   requiresConfirmation: boolean,
 *   root: string|null
 * }}
 */
export function validateProjectRoot(inputPath, opts = {}) {
  const errors = [];
  const warnings = [];
  const evidence = [];
  const fail = (msg) => ({
    valid: false, projectType: 'unknown', engine: null, confidence: 'none',
    evidence, warnings, errors: [...errors, msg], requiresConfirmation: false, root: null
  });

  if (!inputPath || typeof inputPath !== 'string' || !inputPath.trim()) {
    return fail('No folder was provided.');
  }
  const raw = resolve(String(inputPath).trim());
  if (!existsSync(raw)) return fail(`Path does not exist: ${raw}`);

  // Resolve symlinks so a link cannot smuggle a forbidden target past the checks.
  let root;
  try { root = realpathSync(raw); } catch { return fail(`Path cannot be resolved (broken link?): ${raw}`); }
  if (root !== raw) evidence.push(`Resolved symlink → ${root}`);

  let st;
  try { st = statSync(root); } catch { return fail(`Folder is not readable: ${root}`); }
  if (!st.isDirectory()) return fail('This path is a file — Ember connects to a project folder, not a single file.');

  if (isDangerousSystemRoot(root)) {
    return fail('This folder is a system or drive root — Ember refuses to scan it. Pick your game project folder instead.');
  }
  const base = basename(root).toLowerCase();
  if (FORBIDDEN_ROOT_NAMES.has(base)) {
    return fail(`"${basename(root)}" is a dependency/build/cache folder — pick the project root that contains it instead.`);
  }
  if (USER_MEDIA_DIRS.has(base)) {
    return fail(`"${basename(root)}" is a personal system folder — pick the specific game project folder inside it instead.`);
  }

  try { readdirSync(root); } catch { return fail(`Folder is not readable: ${root}`); }

  const detection = detectEngineMarkers(root);
  evidence.push(...detection.evidence);

  const { counts, sourceSamples } = inventory(root);
  if (counts.total === 0) return fail('This folder is empty — there is nothing Ember could truthfully scan.');

  // A recognized engine marker is strong evidence on its own.
  if (detection.confidence === 'high' || detection.confidence === 'medium') {
    if (counts.source === 0 && detection.projectType === 'game') {
      warnings.push('Engine markers found but no source files within the scanned depth — code analysis may be limited.');
    }
    if (sourceSamples.length) evidence.push(`Source files found (e.g. ${sourceSamples.slice(0, 3).join(', ')})`);
    return {
      valid: true, projectType: detection.projectType, engine: detection.engine,
      confidence: detection.confidence, evidence, warnings, errors,
      requiresConfirmation: detection.confidence === 'medium' && detection.projectType === 'code',
      root
    };
  }

  // No engine marker: require real source files, not just media/docs.
  if (counts.source === 0) {
    if (counts.media > 0 && counts.manifest === 0) {
      return fail('This folder only contains media/documents — it does not appear to contain a supported game or code project.');
    }
    return fail('No recognizable source files or project manifest found — this folder does not appear to contain a supported game or code project.');
  }

  const mediaRatio = counts.media / Math.max(1, counts.source + counts.media);
  if (counts.source < 3 && mediaRatio > 0.9) {
    return fail('Almost everything here is media — Ember could not find enough source or configuration to treat this as a project.');
  }

  evidence.push(`${counts.source} source file(s) found (e.g. ${sourceSamples.slice(0, 3).join(', ')})`);
  if (counts.manifest > 0) evidence.push(`${counts.manifest} project manifest(s) found`);
  warnings.push('No engine or manifest marker recognized — connecting as a Custom project requires your explicit confirmation.');
  return {
    valid: true, projectType: 'code', engine: 'custom', confidence: 'low',
    evidence, warnings, errors, requiresConfirmation: !opts.confirmedCustom, root
  };
}
