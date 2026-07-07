/**
 * Bridge between the UI and the machine.
 * - Desktop shell (Electron): window.ember exposes the real agent (preload.cjs).
 * - Browser preview (vite dev / tests): no filesystem access — every agent call
 *   returns an explicit `unavailable` result so the UI shows honest states
 *   instead of fake data. Settings fall back to localStorage.
 */

export const isDesktop = typeof window !== 'undefined' && !!window.ember?.desktop;

const BROWSER_MSG =
  'Browser preview — local project access requires the Ember Desktop shell (npm run dev:desktop) or the CLI (ember run).';

function unavailable() {
  return Promise.resolve({ error: BROWSER_MSG, unavailable: true });
}

const browserBridge = {
  desktop: false,
  settings: {
    async get() {
      try {
        return JSON.parse(localStorage.getItem('ember-settings') ?? '{}');
      } catch {
        return {};
      }
    },
    async set(patch) {
      const next = { ...(await browserBridge.settings.get()), ...patch };
      localStorage.setItem('ember-settings', JSON.stringify(next));
      return next;
    }
  },
  selectFolder: async () => {
    // No native dialog in the browser; caller falls back to a typed path input.
    return null;
  },
  openPath: async () => ({ error: BROWSER_MSG }),
  openExternal: async (url) => {
    window.open(url, '_blank', 'noreferrer');
  },
  project: { detect: unavailable },
  config: { load: unavailable, generate: unavailable, write: unavailable, validate: unavailable },
  agent: {
    scan: unavailable,
    analyze: unavailable,
    logs: unavailable,
    run: unavailable,
    report: unavailable,
    doctor: unavailable,
    listReports: async () => [],
    aiStatus: async () => ({ enabled: false, configured: [], provider: null, reason: BROWSER_MSG }),
    aiExplainBug: unavailable,
    aiSummarizeReport: unavailable,
    onRunStep: () => () => {}
  },
  file: {
    read: unavailable,
    write: unavailable,
    saveAs: async ({ defaultPath, content }) => {
      // Browser fallback: trigger a download.
      const blob = new Blob([content], { type: 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (defaultPath ?? 'ember-export.txt').split('/').pop();
      a.click();
      URL.revokeObjectURL(a.href);
      return a.download;
    }
  }
};

export const bridge = isDesktop ? window.ember : browserBridge;

/** Backend API client (optional — the app is local-first). */
export function apiClient(baseUrl, token) {
  const base = (baseUrl || 'http://localhost:4310').replace(/\/$/, '');
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(data?.error ?? `${res.status}`), { status: res.status, data });
    return data;
  };
  return {
    base,
    health: () => call('GET', '/health'),
    usage: () => call('GET', '/usage'),
    projects: () => call('GET', '/projects'),
    notifications: () => call('GET', '/notifications'),
    plans: () => call('GET', '/billing/plans'),
    subscription: () => call('GET', '/billing/subscription'),
    team: () => call('GET', '/team'),
    invite: (email, role) => call('POST', '/team/invite', { email, role }),
    pushReport: (projectId, report) => call('POST', '/agent/report', { projectId, report }),
    signup: (email, password, name) => call('POST', '/auth/signup', { email, password, name }),
    login: (email, password) => call('POST', '/auth/login', { email, password }),
    logout: () => call('POST', '/auth/logout'),
    me: () => call('GET', '/auth/me'),
    checkout: (planId, provider = 'paypal') => call('POST', '/billing/checkout', { planId, provider }),
    paymentProviders: () => call('GET', '/billing/providers'),
    paypalCapture: (orderId) => call('POST', '/billing/paypal/capture', { orderId }),
    exportRecord: (kind, format, payload) => call('POST', '/exports', { kind, format, payload }),
    importPayload: (kind, payload) => call('POST', '/imports', { kind, payload })
  };
}
