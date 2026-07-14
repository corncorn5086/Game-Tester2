/**
 * Main-process bridge to the real Ember agent core and ProjectValidator.
 *
 * Security model:
 *  - every path from the renderer goes through the shared ProjectValidator;
 *  - only roots that validated OK in this session are allowed to connect/run;
 *  - the agent core (plain ESM, zero deps) is imported dynamically from the
 *    monorepo workspace — no shell, no eval, no arbitrary module loading.
 */
const { ipcMain, dialog, BrowserWindow } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const REPO_ROOT = join(__dirname, '..', '..', '..');
const grantedRoots = new Set();

// file:// URLs are required for dynamic ESM imports of absolute paths
// (a bare `C:\…` path is rejected by the loader on Windows).
async function agentCore() {
  return import(pathToFileURL(join(REPO_ROOT, 'apps', 'agent', 'src', 'index.js')).href);
}
async function validator() {
  return import(pathToFileURL(join(REPO_ROOT, 'shared', 'src', 'project-validator.js')).href);
}

function registerAgentBridge() {
  ipcMain.handle('ember:pick-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose your game project folder',
      properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('ember:validate-project', async (_event, path) => {
    try {
      const { validateProjectRoot } = await validator();
      const res = validateProjectRoot(path);
      if (res.valid) grantedRoots.add(res.root);
      return res;
    } catch (e) {
      return { valid: false, errors: [`Validation failed: ${e.message}`], warnings: [], evidence: [], engine: null, confidence: 'none', projectType: 'unknown', requiresConfirmation: false, root: null };
    }
  });

  ipcMain.handle('ember:connect-project', async (_event, path) => {
    try {
      const { validateProjectRoot } = await validator();
      const validation = validateProjectRoot(path, { confirmedCustom: true });
      if (!validation.valid) return { ok: false, error: 'This folder does not appear to contain a supported game or code project.', validation };
      grantedRoots.add(validation.root);

      const agent = await agentCore();
      // Reuse an existing config when the project already has one; otherwise
      // generate it (generateConfig re-validates and never writes elsewhere).
      const loaded = agent.loadConfig(validation.root);
      if (loaded.config && loaded.root === validation.root) {
        return { ok: true, config: loaded.config, root: loaded.root, written: false, validation };
      }
      const res = agent.generateConfig(validation.root, { write: true, confirmedCustom: true });
      if (res.error) return { ok: false, error: res.error, validation };
      return { ok: true, config: res.config, root: validation.root, written: res.written, validation };
    } catch (e) {
      return { ok: false, error: `Connect failed: ${e.message}` };
    }
  });

  ipcMain.handle('ember:run-profile', async (event, path, profile) => {
    try {
      if (!grantedRoots.has(path)) {
        return { ok: false, error: 'This folder was not validated in this session — reconnect the project first.' };
      }
      const agent = await agentCore();
      const loaded = agent.loadConfig(path);
      if (!loaded.config) return { ok: false, error: loaded.errors.join(' · ') };

      const send = (step) => { try { event.sender.send('ember:run-step', step); } catch { /* window closed mid-run */ } };
      const run = await agent.runProfile(loaded.config, loaded.root, profile, { onStep: send });

      // Build the full evidence-based report from the same real signals.
      const scan = agent.scanProject(loaded.config, loaded.root);
      const analysis = agent.analyzeCode(loaded.config, loaded.root, { scan });
      const logs = agent.analyzeLogs(loaded.config, loaded.root);
      const report = agent.buildReport({ config: loaded.config, root: loaded.root, scan, analyze: analysis, logs, run });
      const markdown = agent.reportToMarkdown(report);
      // Strip the per-file inventory — the renderer needs metrics + bugs only.
      const { scan: _scan, ...slim } = report;
      return { ok: true, report: { ...slim, scan: undefined }, markdown, runStatus: run.status };
    } catch (e) {
      return { ok: false, error: `Run failed: ${e.message}` };
    }
  });
}

module.exports = { registerAgentBridge };
