/**
 * Ember Desktop global state (final: real accounts + real projects only).
 * Phases: splash → auth → onboarding → app.
 * Modes: 'real' (project connected) or 'none'.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { bridge, isDesktop, apiClient } from './bridge.js';
import { translate, dirFor } from './i18n.js';

const AppCtx = createContext(null);

export const DEFAULT_SETTINGS = {
  backendUrl: 'http://localhost:4310',
  agentPath: '',
  defaultProjectFolder: '',
  defaultReportFolder: '',
  preferredEngine: 'auto',
  theme: 'dark',
  accentColor: '#ff4d00',
  language: 'en',
  animationIntensity: 'full',
  scanMode: 'deep',
  maxFilesToAnalyze: 10000,
  ignoreFolders: 'Library, Temp, node_modules, .git',
  includeExtensions: '',
  excludeExtensions: '',
  privacyMode: false,
  aiProvider: 'auto', // 'auto' | 'claude' | 'openai'
  cloudSync: true,
  maskSecrets: true,
  doNotUploadCode: true,
  notificationsEnabled: true,
  exportFormat: 'json+md',
  exportIncludeLogs: true,
  exportIncludeEvidence: true,
  dataRetentionDays: 90,
  authToken: '',
  authEmail: '',
  session: null, // { name, email, ws, kind: 'account' }
  onboarded: false,
  recentProjects: []
};

/** Build a professional bug record from a real signal (finding or log entry). */
export function bugFromSignal(src, seq) {
  const id = `EMB-${String(seq).padStart(3, '0')}`;
  const isLog = !!src.level;
  const sev = src.severity ?? src.sev ?? (src.level === 'crash' ? 'critical' : src.level === 'error' ? 'high' : 'medium');
  return {
    id,
    severity: sev,
    title: src.message && !src.title ? src.message : src.title ?? src.message,
    category: src.category ?? (isLog ? 'crash' : 'gameplay'),
    status: 'open',
    source: isLog ? 'logs' : 'code-analysis',
    filesInvolved: src.file ? [src.file] : [],
    logsInvolved: isLog && src.logFile ? [src.logFile] : [],
    line: src.line ?? null,
    evidence: src.evidence ?? src.message ?? '',
    stepsToReproduce: src.stepsToReproduce ?? ['Reproduction steps pending triage — evidence attached.'],
    suggestedFix: src.suggest ?? src.suggestedFix ?? null,
    reproducibilityConfidence: isLog ? (src.occurrences > 1 ? 'high' : 'low') : 'high',
    regressionRisk: sev === 'critical' || sev === 'high' ? 'high' : 'medium',
    createdAt: new Date().toISOString()
  };
}

export function AppProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [phase, setPhase] = useState('splash'); // splash | auth | onboarding | app
  const [project, setProject] = useState(null); // { path, root, config, configPath, detection, warnings }
  const [module, setModule] = useState('command');
  const [moduleParam, setModuleParam] = useState(null); // e.g. a Settings/Account sub-section to open
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [backendHealth, setBackendHealth] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);

  // shared real data
  const [analysis, setAnalysis] = useState(null); // result of agent.analyze
  const [logsRes, setLogsRes] = useState(null); // result of agent.logs
  const [lastRun, setLastRun] = useState(null);
  const [reports, setReports] = useState([]); // newest first, full report objects
  const [bugs, setBugs] = useState([]); // triage list
  const [bugSeq, setBugSeq] = useState(1);
  const [selectedBug, setSelectedBug] = useState(null);
  const [activity, setActivity] = useState([]); // { icon, color, text, time }
  const [user, setUser] = useState(null); // full profile from /auth/me
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  useEffect(() => {
    bridge.settings.get().then((s) => {
      const merged = { ...DEFAULT_SETTINGS, ...s };
      setSettings(merged);
      setSettingsLoaded(true);
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
    document.documentElement.style.setProperty('--accent', settings.accentColor || '#ff4d00');
  }, [settings.theme, settings.accentColor]);

  // Apply language + text direction (RTL for Arabic) across the whole app.
  const lang = settings.language || 'en';
  const dir = dirFor(lang);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);
  const t = useCallback((key, vars) => translate(lang, key, vars), [lang]);

  const saveSettings = useCallback(async (patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      bridge.settings.set(next);
      return next;
    });
  }, []);

  const toast = useCallback((msg) => {
    setToastMsg(msg);
    clearTimeout(toast._t);
    toast._t = setTimeout(() => setToastMsg(null), 2800);
  }, []);

  const logActivity = useCallback((icon, color, text) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setActivity((a) => [{ icon, color, text, time }, ...a.slice(0, 19)]);
  }, []);

  /** Navigate to a module, optionally targeting a sub-section (used by the profile menu). */
  const openModule = useCallback((mod, param = null) => {
    setModule(mod);
    setModuleParam(param);
    setProfileMenuOpen(false);
  }, []);

  const api = useMemo(
    () => apiClient(settings.backendUrl, settings.authToken || undefined),
    [settings.backendUrl, settings.authToken]
  );

  const refreshUser = useCallback(async () => {
    if (!settings.authToken) { setUser(null); return null; }
    try {
      const res = await api.me();
      setUser(res.user);
      // Reapply the language saved on the account.
      if (res.user?.language && res.user.language !== settings.language) {
        saveSettings({ language: res.user.language });
      }
      return res.user;
    } catch {
      return null;
    }
  }, [api, settings.authToken, settings.language, saveSettings]);

  // Load the profile whenever a token is present (persistent login).
  useEffect(() => {
    if (settingsLoaded && settings.authToken) refreshUser();
  }, [settingsLoaded, settings.authToken, refreshUser]);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* best effort */ }
    setUser(null);
    setProfileMenuOpen(false);
    await saveSettings({ session: null, authToken: '', authEmail: '' });
    setProject(null);
    setPhase('auth');
  }, [api, saveSettings]);

  useEffect(() => {
    if (!settingsLoaded) return;
    let alive = true;
    const check = () =>
      api.health()
        .then((h) => alive && setBackendHealth({ ok: true, version: h.version }))
        .catch(() => alive && setBackendHealth({ ok: false }));
    check();
    const t = setInterval(check, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [api, settingsLoaded]);

  const connectProject = useCallback(
    async (dir) => {
      const loaded = await bridge.config.load(dir);
      if (loaded.unavailable) {
        toast(loaded.error);
        return null;
      }
      if (!loaded.config) {
        return { needsInit: true, dir, errors: loaded.errors, warnings: loaded.warnings ?? [] };
      }
      const detection = await bridge.project.detect(loaded.root);
      const proj = { path: dir, root: loaded.root, config: loaded.config, configPath: loaded.path, detection, warnings: loaded.warnings ?? [] };
      setProject(proj);
      saveSettings({ recentProjects: [dir, ...settings.recentProjects.filter((p) => p !== dir)].slice(0, 8) });
      logActivity('⌁', 'var(--info)', `Project connected: ${loaded.config.projectName} (${loaded.config.engine})`);
      toast(`${loaded.config.projectName} connected — real mode`);
      return proj;
    },
    [saveSettings, settings.recentProjects, toast, logActivity]
  );

  const disconnectProject = useCallback(() => {
    setProject(null);
    setAnalysis(null);
    setLogsRes(null);
    setLastRun(null);
    setBugs([]);
    setReports([]);
  }, []);

  /** Ingest a real generated report: store it + open bugs into the triage list. */
  const ingestReport = useCallback((report) => {
    setReports((r) => [report, ...r.filter((x) => x.id !== report.id)]);
    setBugs((existing) => {
      const known = new Set(existing.map((b) => b.evidence + b.title));
      const fresh = (report.bugs ?? []).filter((b) => !known.has(b.evidence + b.title));
      return [...fresh, ...existing];
    });
    logActivity('▤', 'var(--ok)', `QA report generated — ${report.metrics?.bugsFound ?? 0} issue(s)`);
  }, [logActivity]);

  const createBug = useCallback((src) => {
    setBugSeq((seq) => {
      const bug = bugFromSignal(src, seq);
      setBugs((b) => [bug, ...b]);
      toast(`${bug.id} created — view it in Bugs`);
      logActivity('⬡', 'var(--high)', `Bug created: ${bug.title.slice(0, 60)}`);
      return seq + 1;
    });
  }, [toast, logActivity]);

  const updateBug = useCallback((id, patch) => {
    setBugs((b) => b.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    setSelectedBug((s) => (s && s.id === id ? { ...s, ...patch } : s));
  }, []);

  // final version: a project is connected (real) or nothing is
  const mode = project ? 'real' : 'none';

  const value = {
    settings, settingsLoaded, saveSettings,
    t, lang, dir,
    phase, setPhase,
    project, setProject, connectProject, disconnectProject,
    module, setModule, moduleParam, setModuleParam, openModule,
    mode, isDesktop,
    api, backendHealth,
    toastMsg, toast,
    paletteOpen, setPaletteOpen,
    analysis, setAnalysis,
    logsRes, setLogsRes,
    lastRun, setLastRun,
    reports, setReports, ingestReport,
    bugs, setBugs, createBug, updateBug, selectedBug, setSelectedBug,
    activity, logActivity,
    user, setUser, refreshUser, logout,
    profileMenuOpen, setProfileMenuOpen
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp outside AppProvider');
  return ctx;
}
