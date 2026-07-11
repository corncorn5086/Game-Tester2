#!/usr/bin/env node
/**
 * Starts backend + web together for local development.
 * The desktop app is a native Electron window — launch it separately with
 * `npm run dev:desktop`. Ctrl-C stops everything here.
 */
import { spawn } from 'node:child_process';

const procs = [
  ['backend', 'npm', ['run', 'dev:backend']],
  ['web', 'npm', ['run', 'dev:web']]
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = `[${name}]`.padEnd(10);
  p.stdout.on('data', (d) => process.stdout.write(d.toString().replace(/^/gm, tag)));
  p.stderr.on('data', (d) => process.stderr.write(d.toString().replace(/^/gm, tag)));
  p.on('exit', (code) => console.log(`${tag} exited (${code})`));
  return p;
});

process.on('SIGINT', () => {
  for (const p of procs) p.kill('SIGINT');
  process.exit(0);
});
