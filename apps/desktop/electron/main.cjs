/**
 * Ember Desktop — Electron main process.
 * Bridges the renderer to the real Ember Agent core (@ember/agent):
 * every scan/analysis/run/report the UI shows comes from these handlers.
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

let agent = null; // ESM module, loaded dynamically
async function loadAgent() {
  if (!agent) agent = await import('@ember/agent');
  return agent;
}

const settingsFile = () => join(app.getPath('userData'), 'ember-settings.json');

function readSettings() {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  return settings;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0a090c',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Which UI to show:
  //   EMBER_UI=react      → the functional React app (Vite dev server or built dist)
  //   EMBER_UI=standalone → the self-contained v3 design mockup (default)
  const ui = process.env.EMBER_UI || 'standalone';
  const devServer = process.env.EMBER_DEV_SERVER;
  if (ui === 'react' && devServer) win.loadURL(devServer);
  else if (ui === 'react') win.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  else win.loadFile(join(__dirname, '..', 'standalone', 'index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  return win;
}

app.whenReady().then(() => {
  const win = createWindow();

  // ---------- settings ----------
  ipcMain.handle('settings:get', () => readSettings());
  ipcMain.handle('settings:set', (_e, patch) => writeSettings({ ...readSettings(), ...patch }));

  // ---------- dialogs / shell ----------
  ipcMain.handle('dialog:selectFolder', async (_e, title) => {
    const res = await dialog.showOpenDialog(win, { title: title ?? 'Select folder', properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
  ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));

  // Pick a profile photo and return it as a data URL the renderer can preview
  // and send straight to the backend — no separate upload endpoint needed.
  ipcMain.handle('dialog:selectImage', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a profile photo',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const path = res.filePaths[0];
    const stat = require('node:fs').statSync(path);
    if (stat.size > 1_200_000) return { error: 'Image is too large — pick one under ~1MB.' };
    const ext = path.split('.').pop().toLowerCase();
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[ext] ?? 'image/png';
    const dataUrl = `data:${mime};base64,${readFileSync(path).toString('base64')}`;
    return { dataUrl };
  });

  // ---------- project / config ----------
  ipcMain.handle('project:detect', async (_e, dir) => {
    const { detectEngine } = await loadAgent();
    return detectEngine(dir);
  });
  ipcMain.handle('config:load', async (_e, dir) => {
    const { loadConfig } = await loadAgent();
    const { config, path, root, errors, warnings } = loadConfig(dir);
    return { config, path, root, errors, warnings };
  });
  ipcMain.handle('config:generate', async (_e, dir, opts) => {
    const { generateConfig } = await loadAgent();
    return generateConfig(dir, { ...opts, write: true });
  });
  ipcMain.handle('config:write', async (_e, path, config) => {
    writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
    return { ok: true };
  });
  ipcMain.handle('config:validate', async (_e, dir) => {
    const { loadConfig, validateConfig } = await loadAgent();
    const loaded = loadConfig(dir);
    if (!loaded.config) return { valid: false, errors: loaded.errors, warnings: loaded.warnings };
    return validateConfig(loaded.config);
  });

  // ---------- agent operations (real) ----------
  ipcMain.handle('agent:scan', async (_e, dir) => {
    const { loadConfig, scanProject } = await loadAgent();
    const { config, root, errors } = loadConfig(dir);
    if (!config) return { error: errors.join('; ') };
    const scan = scanProject(config, root);
    return { ...scan, sourceFiles: scan.sourceFiles.slice(0, 500).map(({ path, size, ext }) => ({ path, size, ext })) };
  });

  ipcMain.handle('agent:analyze', async (_e, dir) => {
    const { loadConfig, analyzeCode } = await loadAgent();
    const { config, root, errors } = loadConfig(dir);
    if (!config) return { error: errors.join('; ') };
    const analysis = analyzeCode(config, root);
    const { sourceFiles, ...scan } = analysis.scan;
    return { ...analysis, scan };
  });

  ipcMain.handle('agent:logs', async (_e, dir) => {
    const { loadConfig, analyzeLogs } = await loadAgent();
    const { config, root, errors } = loadConfig(dir);
    if (!config) return { error: errors.join('; ') };
    return analyzeLogs(config, root);
  });

  ipcMain.handle('agent:run', async (e, dir, profile) => {
    const { loadConfig, runProfile, LocalStore } = await loadAgent();
    const { config, root, errors } = loadConfig(dir);
    if (!config) return { error: errors.join('; ') };
    const run = await runProfile(config, root, profile, {
      onStep: (step) => e.sender.send('agent:run-step', step)
    });
    try {
      new LocalStore(root).saveRun(run);
    } catch { /* history is best-effort */ }
    return run;
  });

  ipcMain.handle('agent:report', async (e, dir, opts = {}) => {
    const { loadConfig, scanProject, analyzeCode, analyzeLogs, runProfile, buildReport, reportToMarkdown, LocalStore } = await loadAgent();
    const { config, root, errors } = loadConfig(dir);
    if (!config) return { error: errors.join('; ') };
    const send = (step) => e.sender.send('agent:run-step', step);
    send({ at: new Date().toISOString(), type: 'running', check: 'scan', message: 'Scanning project…' });
    const scan = scanProject(config, root);
    send({ at: new Date().toISOString(), type: 'running', check: 'analyze', message: `Analyzing ${scan.sourceFileCount} source files…` });
    const analysis = analyzeCode(config, root, { scan });
    send({ at: new Date().toISOString(), type: 'running', check: 'logs', message: 'Parsing logs…' });
    const logs = analyzeLogs(config, root);
    const run = opts.profile ? await runProfile(config, root, opts.profile, { onStep: send }) : null;
    const report = buildReport({ config, root, scan, analyze: analysis, logs, run });
    const store = new LocalStore(root);
    const previous = store.latestReport();
    if (previous) {
      const diff = store.compareReports(previous, report);
      report.regression = {
        comparedTo: previous.id,
        fixed: diff.fixed.map((b) => b.title),
        stillPresent: diff.stillPresent.length,
        new: diff.new.map((b) => b.title)
      };
    }
    store.saveReport(report);
    report.markdown = reportToMarkdown(report);
    return report;
  });

  ipcMain.handle('agent:reportPdf', async (_e, report) => {
    try {
      const { buildReportPdf } = require('./pdf.cjs');
      const buf = await buildReportPdf(report, { logoPath: join(__dirname, '..', 'src', 'assets', 'ember-logo.png') });
      return { ok: true, base64: buf.toString('base64') };
    } catch (e) {
      return { ok: false, error: `PDF generation failed: ${e.message}` };
    }
  });

  const normalizeProvider = (p) => (p === 'claude' || p === 'openai' ? p : undefined);

  ipcMain.handle('agent:aiStatus', async (_e, provider) => {
    const { aiStatus } = await loadAgent();
    return aiStatus(normalizeProvider(provider));
  });

  ipcMain.handle('agent:aiExplainBug', async (_e, bug, provider) => {
    const { explainBug } = await loadAgent();
    return explainBug(bug, { provider: normalizeProvider(provider) });
  });

  ipcMain.handle('agent:aiSummarizeReport', async (_e, report, provider) => {
    const { summarizeReport } = await loadAgent();
    return summarizeReport(report, { provider: normalizeProvider(provider) });
  });

  ipcMain.handle('agent:aiTriageBug', async (_e, bug, provider) => {
    const { triageBug } = await loadAgent();
    return triageBug(bug, { provider: normalizeProvider(provider) });
  });

  ipcMain.handle('agent:doctor', async (_e, dir) => {
    const { doctor } = await loadAgent();
    return doctor(dir ?? process.cwd());
  });

  ipcMain.handle('system:info', async () => {
    const os = require('node:os');
    const { execFile } = require('node:child_process');
    // `ember` with no args prints usage and exits 0 when installed on PATH.
    const cliInstalled = await new Promise((resolve) => {
      execFile('ember', [], { timeout: 3000, shell: process.platform === 'win32' }, (err) => resolve(!err));
    }).catch(() => false);
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      platform: os.platform(),
      osRelease: os.release(),
      arch: process.arch,
      cliInstalled
    };
  });

  ipcMain.handle('agent:listReports', async (_e, dir) => {
    const { loadConfig, LocalStore } = await loadAgent();
    const { root } = loadConfig(dir);
    if (!root) return [];
    return new LocalStore(root).listReports();
  });

  ipcMain.handle('file:read', (_e, path) => {
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf8').slice(0, 2 * 1024 * 1024);
  });
  ipcMain.handle('file:write', (_e, path, content) => {
    writeFileSync(path, content);
    return { ok: true };
  });
  ipcMain.handle('file:saveDialog', async (_e, { title, defaultPath, content, encoding }) => {
    const res = await dialog.showSaveDialog(win, { title, defaultPath });
    if (res.canceled || !res.filePath) return null;
    writeFileSync(res.filePath, encoding === 'base64' ? Buffer.from(content, 'base64') : content);
    return res.filePath;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
