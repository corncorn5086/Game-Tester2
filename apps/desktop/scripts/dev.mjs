#!/usr/bin/env node
/**
 * Dev launcher: starts the Vite renderer, waits for it, then opens Electron.
 * If the Electron binary is unavailable (e.g. sandboxed CI), keeps the
 * renderer running in browser mode and says so instead of failing.
 */
import { spawn } from 'node:child_process';

const vite = spawn('npx', ['vite', '--port', '4312'], { stdio: 'inherit', shell: process.platform === 'win32' });

async function waitForVite() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://localhost:4312/');
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const up = await waitForVite();
if (!up) {
  console.error('[ember-desktop] vite did not start');
  process.exit(1);
}

const electron = spawn('npx', ['electron', '.'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, EMBER_UI: 'react', EMBER_DEV_SERVER: 'http://localhost:4312' }
});
electron.on('error', () => {
  console.warn('[ember-desktop] Electron binary not available — renderer keeps running at http://localhost:4312 (browser mode: local project access requires the desktop shell).');
});
electron.on('exit', (code) => {
  if (code !== 0) console.warn('[ember-desktop] Electron exited; renderer still available at http://localhost:4312');
});

process.on('SIGINT', () => {
  vite.kill('SIGINT');
  electron.kill('SIGINT');
  process.exit(0);
});
