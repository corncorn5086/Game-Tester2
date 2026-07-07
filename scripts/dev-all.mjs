#!/usr/bin/env node
/**
 * Starts backend + web + desktop renderer together for local development.
 * Ctrl-C stops everything.
 */
import { spawn } from 'node:child_process';

const procs = [
  ['backend', 'npm', ['run', 'dev:backend']],
  ['web', 'npm', ['run', 'dev:web']],
  ['desktop', 'npm', ['run', 'dev:desktop:renderer']]
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
