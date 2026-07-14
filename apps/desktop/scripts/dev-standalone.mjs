#!/usr/bin/env node
/**
 * Dev launcher: opens Electron directly on the Ember Desktop redesign
 * (apps/desktop/standalone/index.html). No dev server, no ports to collide
 * with. Fully offline — React, Babel, fonts and the 3D runtime are all
 * vendored inside standalone/.
 */
import { spawn } from 'node:child_process';

const electron = spawn('npx', ['electron', '.'], {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

electron.on('error', () => {
  console.warn('[ember-desktop] Electron binary not available in this environment.');
});
electron.on('exit', (code) => process.exit(code ?? 0));

process.on('SIGINT', () => {
  electron.kill('SIGINT');
  process.exit(0);
});
