/**
 * Ember Cloud (Supabase) sync layer.
 *
 * The backend stays local-first (SQLite is the source of truth). When
 * SUPABASE_URL + SUPABASE_ANON_KEY are set, writes are mirrored to the
 * Supabase Postgres project over PostgREST so the team shares one cloud
 * triage board. Failures never break local operation — they are recorded
 * and surfaced via /health.
 *
 * NOTE: the dev RLS policies allow the publishable key to read/write app
 * tables. Tighten them (service role + per-workspace policies) before any
 * public deployment — see docs/security.md.
 */

const URL_ = process.env.SUPABASE_URL ?? '';
const KEY = process.env.SUPABASE_ANON_KEY ?? '';

export const supabaseEnabled = !!(URL_ && KEY);

let lastError = null;
let lastSyncAt = null;

async function rest(method, path, body, { prefer } = {}) {
  if (!supabaseEnabled) return null;
  const res = await fetch(`${URL_.replace(/\/$/, '')}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      ...(prefer ? { prefer } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`supabase ${method} ${path} → ${res.status} ${detail.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

/** Fire-and-forget mirror; records failures instead of throwing. */
async function mirror(fn) {
  if (!supabaseEnabled) return;
  try {
    await fn();
    lastSyncAt = new Date().toISOString();
    lastError = null;
  } catch (e) {
    lastError = e.message;
    console.warn('[ember-cloud]', e.message);
  }
}

export function cloudStatus() {
  return { enabled: supabaseEnabled, url: supabaseEnabled ? URL_ : null, lastSyncAt, lastError };
}

export async function cloudHealth() {
  if (!supabaseEnabled) return { ok: false, reason: 'not configured' };
  try {
    await rest('GET', 'workspaces?select=id&limit=1');
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

const upsert = (table, rows) =>
  rest('POST', `${table}?on_conflict=id`, rows, { prefer: 'resolution=merge-duplicates,return=minimal' });

export function mirrorProject(p) {
  return mirror(() =>
    upsert('projects', [{
      id: p.id, workspace_id: p.workspaceId ?? null, name: p.name, engine: p.engine ?? 'custom',
      path: p.path ?? null, config_json: p.config ?? {}, updated_at: new Date().toISOString()
    }])
  );
}

export function mirrorReport(projectId, report) {
  return mirror(async () => {
    await upsert('reports', [{
      id: report.id, project_id: projectId ?? null, generated_at: report.generatedAt ?? new Date().toISOString(),
      summary: report.executiveSummary ?? null, metrics_json: report.metrics ?? {}, report_json: report
    }]);
    const bugs = (report.bugs ?? []).map((b) => ({
      id: b.id, project_id: projectId ?? null, title: b.title, description: b.description ?? null,
      severity: b.severity ?? 'medium', category: b.category ?? 'gameplay', source: b.source ?? 'code-analysis',
      status: b.status ?? 'open', evidence: b.evidence ?? null, reproducibility: b.reproducibilityConfidence ?? null,
      regression_risk: b.regressionRisk ?? null, suggested_fix: b.suggestedFix ?? null,
      created_at: b.createdAt ?? new Date().toISOString(), updated_at: new Date().toISOString(),
      detail_json: {
        filesInvolved: b.filesInvolved ?? [], logsInvolved: b.logsInvolved ?? [],
        stepsToReproduce: b.stepsToReproduce ?? [], ruleId: b.ruleId ?? null
      }
    }));
    if (bugs.length) await upsert('bugs', bugs);
  });
}

export function mirrorBugPatch(id, patch) {
  return mirror(() =>
    rest('PATCH', `bugs?id=eq.${encodeURIComponent(id)}`, { ...patch, updated_at: new Date().toISOString() }, { prefer: 'return=minimal' })
  );
}

export function mirrorEvent(event) {
  return mirror(() =>
    rest('POST', 'agent_events', [{ id: event.id, project_id: event.projectId ?? null, kind: event.kind, payload_json: event.payload ?? {} }], { prefer: 'return=minimal' })
  );
}

export function mirrorInvite(member) {
  return mirror(() =>
    upsert('team_members', [{
      id: member.id, workspace_id: member.workspaceId, email: member.email,
      role: member.role, status: member.status ?? 'invited'
    }])
  );
}

/** Read helpers (used when the caller prefers cloud data). */
export function cloudTeam() {
  return rest('GET', 'team_members?select=id,workspace_id,email,role,status,invited_at&order=invited_at.asc');
}

/** Look up a cloud user by email (login fallback: imports the admin account
 *  onto a fresh local install). Returns null when not found/unreachable. */
export async function cloudUserByEmail(email) {
  try {
    const rows = await rest('GET', `users?select=id,email,name,password_hash,created_at&email=eq.${encodeURIComponent(email)}&limit=1`);
    return rows?.[0] ?? null;
  } catch {
    return null;
  }
}
