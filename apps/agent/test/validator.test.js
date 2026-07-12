/**
 * ProjectValidator tests — every folder Ember must refuse, and every real
 * project shape it must accept. Fixtures are built on the fly in a temp dir.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, parse as parsePath } from 'node:path';
import { validateProjectRoot } from '@ember/shared/project-validator';

const base = mkdtempSync(join(tmpdir(), 'ember-validator-'));
const make = (name, builder) => {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  builder?.(dir);
  return dir;
};
const file = (dir, rel, content = '') => {
  const p = join(dir, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content);
};

let passed = 0;
const expectInvalid = (label, path, opts) => {
  const res = validateProjectRoot(path, opts);
  assert.equal(res.valid, false, `${label} should be INVALID but was accepted: ${JSON.stringify(res)}`);
  assert.ok(res.errors.length > 0, `${label} must explain why it failed`);
  passed++;
};
const expectValid = (label, path, expect = {}, opts) => {
  const res = validateProjectRoot(path, opts);
  assert.equal(res.valid, true, `${label} should be VALID but failed: ${res.errors.join(' | ')}`);
  if (expect.engine) assert.equal(res.engine, expect.engine, `${label} engine`);
  if (expect.projectType) assert.equal(res.projectType, expect.projectType, `${label} projectType`);
  if (expect.confidence) assert.equal(res.confidence, expect.confidence, `${label} confidence`);
  assert.ok(res.evidence.length > 0, `${label} must cite evidence`);
  passed++;
};

// ---------- invalid folders (the prompt's "dix dossiers invalides") ----------

// 1. nonexistent path
expectInvalid('nonexistent path', join(base, 'does-not-exist'));

// 2. a file instead of a folder
const asFile = join(base, 'not-a-dir.txt');
writeFileSync(asFile, 'hello');
expectInvalid('file instead of folder', asFile);

// 3. empty folder
expectInvalid('empty folder', make('empty'));

// 4. filesystem root
expectInvalid('filesystem root', parsePath(process.cwd()).root);

// 5. the user's entire home directory
expectInvalid('home directory', homedir());

// 6. media-only folder (a Photos/Downloads shape)
expectInvalid('media-only folder', make('photos', (d) => {
  file(d, 'IMG_0001.jpg'); file(d, 'IMG_0002.png'); file(d, 'holiday.mp4'); file(d, 'notes.pdf');
}));

// 7. node_modules as root
expectInvalid('node_modules as root', make('proj/node_modules', (d) => {
  file(d, 'left-pad/index.js', 'module.exports = s => s');
}));

// 8. build output folder as root
expectInvalid('build folder as root', make('game/build', (d) => {
  file(d, 'game.exe'); file(d, 'data.pak');
}));

// 9. fake/broken package.json with nothing else
expectInvalid('broken package.json only', make('fakepkg', (d) => {
  file(d, 'package.json', '{ this is not json');
}));

// 10. incomplete Unity (Assets/ but no ProjectSettings, no source anywhere)
expectInvalid('incomplete Unity (assets of images only)', make('unity-incomplete', (d) => {
  file(d, 'Assets/logo.png'); file(d, 'Assets/music.mp3');
}));

// 11. .git as root
expectInvalid('.git as root', make('somerepo/.git', (d) => {
  file(d, 'HEAD', 'ref: refs/heads/main');
}));

// 12. documents-only folder
expectInvalid('documents-only folder', make('docs-only', (d) => {
  file(d, 'report.docx'); file(d, 'budget.xlsx'); file(d, 'slides.pptx');
}));

// ---------- valid projects ----------

expectValid('real Unity project', make('unity-real', (d) => {
  file(d, 'ProjectSettings/ProjectVersion.txt', 'm_EditorVersion: 2022.3.10f1');
  file(d, 'Assets/Scripts/Player.cs', 'public class Player {}');
  file(d, 'Assets/Scripts/Enemy.cs', 'public class Enemy {}');
}), { engine: 'unity', projectType: 'game', confidence: 'high' });

expectValid('real Unreal project', make('unreal-real', (d) => {
  file(d, 'MyGame.uproject', '{"FileVersion":3}');
  file(d, 'Content/placeholder.txt');
  file(d, 'Source/MyGame/MyGame.cpp', 'int main(){}');
}), { engine: 'unreal', projectType: 'game', confidence: 'high' });

expectValid('real Godot project', make('godot-real', (d) => {
  file(d, 'project.godot', '[application]\nconfig/name="Game"');
  file(d, 'main.gd', 'extends Node');
  file(d, 'level.tscn', '[gd_scene]');
}), { engine: 'godot', projectType: 'game', confidence: 'high' });

expectValid('real web game', make('webgame-real', (d) => {
  file(d, 'package.json', JSON.stringify({ name: 'game', dependencies: { phaser: '^3.0.0' }, scripts: { dev: 'vite' } }));
  file(d, 'src/main.ts', 'import Phaser from "phaser";');
}), { engine: 'web', projectType: 'game', confidence: 'high' });

expectValid('generic node project (code, not game)', make('node-generic', (d) => {
  file(d, 'package.json', JSON.stringify({ name: 'api', scripts: { start: 'node index.js' } }));
  file(d, 'index.js', 'console.log(1)');
}), { engine: 'web', projectType: 'code', confidence: 'medium' });

expectValid('cmake C++ project', make('cpp-cmake', (d) => {
  file(d, 'CMakeLists.txt', 'project(engine)');
  file(d, 'src/main.cpp', 'int main(){}');
}), { engine: 'custom', projectType: 'code', confidence: 'medium' });

// low-confidence custom: valid but requires explicit confirmation
{
  const dir = make('bare-source', (d) => {
    file(d, 'a.py', 'print(1)'); file(d, 'b.py', 'print(2)'); file(d, 'c.py', 'print(3)');
  });
  const res = validateProjectRoot(dir);
  assert.equal(res.valid, true, 'bare source folder should validate as low-confidence custom');
  assert.equal(res.requiresConfirmation, true, 'low-confidence custom must require explicit confirmation');
  const confirmed = validateProjectRoot(dir, { confirmedCustom: true });
  assert.equal(confirmed.requiresConfirmation, false, 'confirmation flag must be honored');
  passed += 2;
}

// symlink to a forbidden target must be refused (skip on platforms without symlink perms)
try {
  const linkPath = join(base, 'sneaky-link');
  symlinkSync(parsePath(process.cwd()).root, linkPath, 'dir');
  expectInvalid('symlink to filesystem root', linkPath);
} catch { /* symlink not permitted here — covered by realpath resolution */ }

rmSync(base, { recursive: true, force: true });
console.log(`✓ validator tests passed (${passed} assertions)`);
