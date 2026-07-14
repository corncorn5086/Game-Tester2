#!/usr/bin/env node
/**
 * Lightweight lint: syntax-checks every JS/MJS/CJS source file in the repo
 * with `node --check`, and JSX/TSX files with esbuild's parser.
 * Zero-config so it runs everywhere (CI, fresh clones) without extra deps.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'release', 'design', 'data', 'vendor']);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const files = walk(ROOT);
const plain = files.filter((f) => ['.js', '.mjs', '.cjs'].includes(extname(f)));
const jsx = files.filter((f) => ['.jsx', '.tsx', '.ts'].includes(extname(f)));

let failed = 0;

for (const f of plain) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`✗ ${f}\n${err.stderr?.toString() ?? err.message}`);
  }
}

if (jsx.length) {
  let esbuild = null;
  try {
    esbuild = await import('esbuild');
  } catch {
    console.warn(`(esbuild not installed — skipping ${jsx.length} JSX/TS files; run npm install first)`);
  }
  if (esbuild) {
    const { readFileSync } = await import('node:fs');
    for (const f of jsx) {
      try {
        await esbuild.transform(readFileSync(f, 'utf8'), {
          loader: extname(f).slice(1),
          jsx: 'automatic'
        });
      } catch (err) {
        failed++;
        console.error(`✗ ${f}\n${err.message}`);
      }
    }
  }
}

if (failed) {
  console.error(`\nlint: ${failed} file(s) failed syntax check`);
  process.exit(1);
}
console.log(`lint: ${plain.length + jsx.length} files OK`);
