/**
 * Auto-start the Ember backend inside the desktop app.
 *
 * Customers launch one thing: Ember Desktop. If the backend isn't already
 * running on this machine (a dev may have started it separately), the main
 * process imports the Express app and listens on the local port itself —
 * no terminal, no `npm run dev:backend`, no dev instructions in the UI.
 */
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const REPO_ROOT = join(__dirname, '..', '..', '..');
const PORT = Number(process.env.EMBER_BACKEND_PORT ?? 4310);

async function healthy(url) {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    const data = await res.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

async function ensureBackend() {
  const url = `http://127.0.0.1:${PORT}`;
  if (await healthy(url)) {
    console.log(`[ember-desktop] backend already running at ${url}`);
    return { url, started: false };
  }
  try {
    const serverModule = pathToFileURL(join(REPO_ROOT, 'backend', 'src', 'server.js')).href;
    const { createApp } = await import(serverModule);
    await new Promise((resolve, reject) => {
      const server = createApp().listen(PORT, '127.0.0.1', resolve);
      server.on('error', reject);
    });
    console.log(`[ember-desktop] backend auto-started at ${url}`);
    return { url, started: true };
  } catch (e) {
    console.error(`[ember-desktop] backend auto-start failed: ${e.message}`);
    return { url, started: false, error: e.message };
  }
}

module.exports = { ensureBackend };
