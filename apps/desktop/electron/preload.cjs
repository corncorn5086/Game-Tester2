/**
 * Ember Desktop — preload bridge.
 * Exposes a small, fixed IPC surface to the renderer. The renderer never
 * gets Node/Electron APIs — only these vetted functions, and the main
 * process re-validates every path against the ProjectValidator allowlist.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('emberDesktop', {
  /** Open the native folder picker. Resolves to an absolute path or null. */
  pickFolder: () => ipcRenderer.invoke('ember:pick-folder'),

  /** Strict project validation (shared ProjectValidator) for a folder. */
  validateProject: (path) => ipcRenderer.invoke('ember:validate-project', String(path ?? '')),

  /** Load or generate ember.config.json in a previously validated folder. */
  connectProject: (path) => ipcRenderer.invoke('ember:connect-project', String(path ?? '')),

  /** Run a real agent profile (scan/analyze/logs/…) in a connected project. */
  runProfile: (path, profile) => ipcRenderer.invoke('ember:run-profile', String(path ?? ''), String(profile ?? 'smoke')),

  /** Subscribe to live step events for the current run. Returns unsubscribe. */
  onRunStep: (callback) => {
    const listener = (_event, step) => callback(step);
    ipcRenderer.on('ember:run-step', listener);
    return () => ipcRenderer.removeListener('ember:run-step', listener);
  }
});
