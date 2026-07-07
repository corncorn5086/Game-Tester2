import { DEFAULT_BACKEND_URL } from '@ember/shared/constants';

/**
 * Optional backend sync. The agent is local-first: every command works
 * without a backend. When config.backend.url (or API_URL) is set, results
 * are pushed so the desktop app / team can see them.
 */
export function backendFromConfig(config) {
  const url = config?.backend?.url || process.env.API_URL || '';
  if (!url) return null;
  return new BackendClient(url, config?.backend?.token || process.env.EMBER_AGENT_TOKEN || null, config?.backend?.projectId || null);
}

export class BackendClient {
  constructor(baseUrl = DEFAULT_BACKEND_URL, token = null, projectId = null) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.projectId = projectId;
  }

  async request(method, path, body) {
    const headers = { 'content-type': 'application/json' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(data?.error ?? `${method} ${path} → ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  health() {
    return this.request('GET', '/health');
  }

  async ensureProject(config, root) {
    if (this.projectId) return this.projectId;
    const created = await this.request('POST', '/projects', {
      name: config.projectName,
      engine: config.engine,
      path: root
    });
    this.projectId = created.id;
    return created.id;
  }

  pushScan(scan, projectId = this.projectId) {
    return this.request('POST', '/agent/scan', { projectId, scan });
  }

  pushAnalysis(analysis, projectId = this.projectId) {
    return this.request('POST', '/agent/analyze', { projectId, analysis });
  }

  pushReport(report, projectId = this.projectId) {
    return this.request('POST', '/agent/report', { projectId, report });
  }
}
