#!/usr/bin/env node
/**
 * Dev launcher: opens Electron directly on the Ember Desktop v3 design
 * (apps/desktop/standalone/index.html). No dev server, no ports to collide
 * with. Needs an internet connection the first time — the design loads
 * React from a CDN.
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
