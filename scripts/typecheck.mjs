#!/usr/bin/env node
/**
 * Typecheck entrypoint. The codebase is plain ESM JavaScript with JSDoc types,
 * so this validates that every workspace parses and that shared schemas are
 * internally consistent (engine profiles, plans, config schema round-trip).
 * When workspaces migrate to TypeScript, swap this for `tsc --noEmit`.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url);

// 1. Syntax pass (same as lint)
execFileSync(process.execPath, [fileURLToPath(new URL('scripts/lint.mjs', ROOT))], { stdio: 'inherit' });

// 2. Semantic pass on shared schemas
const { validateConfig, SAMPLE_CONFIG } = await import(new URL('shared/src/config-schema.js', ROOT));
const { ENGINES } = await import(new URL('shared/src/engines.js', ROOT));
const { PLANS } = await import(new URL('shared/src/plans.js', ROOT));

const res = validateConfig(SAMPLE_CONFIG);
if (!res.valid) {
  console.error('typecheck: SAMPLE_CONFIG fails its own schema:', res.errors);
  process.exit(1);
}
for (const key of ['unity', 'unreal', 'godot', 'web', 'custom']) {
  if (!ENGINES[key]) {
    console.error(`typecheck: missing engine profile "${key}"`);
    process.exit(1);
  }
}
if (!Array.isArray(PLANS) || PLANS.length < 4) {
  console.error('typecheck: billing plans incomplete');
  process.exit(1);
}
console.log('typecheck: schemas OK');
