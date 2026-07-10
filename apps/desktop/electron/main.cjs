/**
 * Ember Desktop — Electron shell.
 * Serves the Ember Desktop v3 design (standalone/) over http://127.0.0.1 and
 * opens it in a native window. HTTP (not file://) is required because the
 * design's runtime does `fetch(location.href)` to resolve its own resources.
 */
const { app, BrowserWindow, shell } = require('electron');
const { join } = require('node:path');
const { startStaticServer } = require('./static-server.cjs');

let staticServer = null;

async function createWindow() {
  if (!staticServer) {
    staticServer = await startStaticServer(join(__dirname, '..', 'standalone'));
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#f4efe7',
    title: 'Ember Desktop',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadURL(`http://127.0.0.1:${staticServer.port}/`);

  // Open any external link in the user's real browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (staticServer) staticServer.close();
  if (process.platform !== 'darwin') app.quit();
});
