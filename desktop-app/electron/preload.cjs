const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

const emberDesktop = Object.freeze({
  getWorkspace() {
    return invoke('ember:workspace:get');
  },

  chooseProjectFolder() {
    return invoke('ember:project:choose-folder');
  },

  inspectProject(path) {
    return invoke('ember:project:inspect', { path });
  },

  addProject(input) {
    if (typeof input === 'string') return invoke('ember:project:add', { path: input, candidate: null });
    return invoke('ember:project:add', {
      path: input?.path || input?.candidate?.path || null,
      candidate: input?.candidate || input || null
    });
  },

  selectProject(id) {
    return invoke('ember:project:select', { id });
  },

  removeProject(id) {
    return invoke('ember:project:remove', { id });
  },

  listReports(projectId = null) {
    return invoke('ember:reports:list', { projectId });
  },

  readConfig(projectId) {
    return invoke('ember:config:read', { projectId });
  },

  saveConfig({ projectId, text, expectedRevision = null } = {}) {
    return invoke('ember:config:save', { projectId, text, expectedRevision });
  },

  getAIStatus() {
    return invoke('ember:ai:status');
  },

  getAuthStatus() {
    return invoke('ember:auth:status');
  },

  login({ email, password } = {}) {
    return invoke('ember:auth:login', { email, password });
  },

  signup({ name, email, password, tosAccepted = false, language = 'en' } = {}) {
    return invoke('ember:auth:signup', { name, email, password, tosAccepted, language });
  },

  updateProfile({ name } = {}) {
    return invoke('ember:auth:update-profile', { name });
  },

  changePassword({ currentPassword, newPassword } = {}) {
    return invoke('ember:auth:change-password', { currentPassword, newPassword });
  },

  logout() {
    return invoke('ember:auth:logout');
  },

  startTest({ projectId = null, path = null, profile = 'smoke', allowCommands = false, enableAI = false } = {}) {
    return invoke('ember:test:start', { projectId, path, profile, allowCommands, enableAI });
  },

  stopTest(runId) {
    return invoke('ember:test:stop', { runId });
  },

  onTestProgress(callback) {
    if (typeof callback !== 'function') throw new TypeError('onTestProgress requires a callback');
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('ember:test:progress', listener);
    return () => ipcRenderer.removeListener('ember:test:progress', listener);
  }
});

contextBridge.exposeInMainWorld('emberDesktop', emberDesktop);
