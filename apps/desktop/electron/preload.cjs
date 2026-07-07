const { contextBridge, ipcRenderer } = require('electron');

/**
 * window.ember — the only bridge between the UI and the machine.
 * Presence of this object means the app runs in the real desktop shell.
 */
contextBridge.exposeInMainWorld('ember', {
  desktop: true,
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch)
  },
  selectFolder: (title) => ipcRenderer.invoke('dialog:selectFolder', title),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  project: {
    detect: (dir) => ipcRenderer.invoke('project:detect', dir)
  },
  config: {
    load: (dir) => ipcRenderer.invoke('config:load', dir),
    generate: (dir, opts) => ipcRenderer.invoke('config:generate', dir, opts),
    write: (path, config) => ipcRenderer.invoke('config:write', path, config),
    validate: (dir) => ipcRenderer.invoke('config:validate', dir)
  },
  agent: {
    scan: (dir) => ipcRenderer.invoke('agent:scan', dir),
    analyze: (dir) => ipcRenderer.invoke('agent:analyze', dir),
    logs: (dir) => ipcRenderer.invoke('agent:logs', dir),
    run: (dir, profile) => ipcRenderer.invoke('agent:run', dir, profile),
    report: (dir, opts) => ipcRenderer.invoke('agent:report', dir, opts),
    doctor: (dir) => ipcRenderer.invoke('agent:doctor', dir),
    listReports: (dir) => ipcRenderer.invoke('agent:listReports', dir),
    aiStatus: (provider) => ipcRenderer.invoke('agent:aiStatus', provider),
    aiExplainBug: (bug, provider) => ipcRenderer.invoke('agent:aiExplainBug', bug, provider),
    aiSummarizeReport: (report, provider) => ipcRenderer.invoke('agent:aiSummarizeReport', report, provider),
    onRunStep: (cb) => {
      const handler = (_e, step) => cb(step);
      ipcRenderer.on('agent:run-step', handler);
      return () => ipcRenderer.removeListener('agent:run-step', handler);
    }
  },
  file: {
    read: (path) => ipcRenderer.invoke('file:read', path),
    write: (path, content) => ipcRenderer.invoke('file:write', path, content),
    saveAs: (opts) => ipcRenderer.invoke('file:saveDialog', opts)
  }
});
