#!/usr/bin/env node
/**
 * Standalone dev launcher: opens Electron directly on the self-contained
 * v3 design (apps/desktop/standalone/index.html). No Vite, no dev server,
 * so there are no ports to collide with. Requires an internet connection
 * the first time because the design loads React from a CDN.
 */
import { spawn } from 'node:child_process';

const electron = spawn('npx', ['electron', '.'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, EMBER_UI: 'standalone' }
});

electron.on('error', () => {
  console.warn('[ember-desktop] Electron binary not available in this environment.');
});
electron.on('exit', (code) => process.exit(code ?? 0));

process.on('SIGINT', () => {
  electron.kill('SIGINT');
  process.exit(0);
});
