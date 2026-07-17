/**
 * Ember Cloud (Supabase) sync layer.
 *
 * The backend stays local-first (SQLite is the source of truth). When
 * SUPABASE_URL and a Supabase key are set, writes are mirrored to the Supabase
 * Postgres project over PostgREST so the team shares one cloud triage board.
 * Failures never break local operation — they are recorded and surfaced via
 * /health.
 *
 * SECURITY: the backend is the only Supabase client and must authenticate with
 * the SERVICE ROLE key (SUPABASE_SERVICE_ROLE_KEY), which bypasses RLS. The
 * production RLS policy denies the public (anon) key all table access, so the
 * publishable key can no longer read/write app data — including users.
 * Password verifiers never leave the local auth database. If only the anon key
 * is set, cloud sync is intentionally
 * denied by the database (recorded in /health), never silently degraded to an
 * insecure state. See docs/security.md.
 */

const URL_ = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
// The backend needs the service-role key to write through the locked-down RLS.
const KEY = SERVICE_KEY || ANON_KEY;
const usingServiceRole = !!SERVICE_KEY;

export const supabaseEnabled = !!(URL_ && KEY);

if (URL_ && ANON_KEY && !SERVICE_KEY) {
  console.warn('[ember-cloud] Only SUPABASE_ANON_KEY is set. Production RLS denies the public key all access — add SUPABASE_SERVICE_ROLE_KEY (Supabase → Settings → API → service_role) to enable cloud sync.');
}

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
  return {
    enabled: supabaseEnabled,
    url: supabaseEnabled ? URL_ : null,
    auth: usingServiceRole ? 'service_role' : (ANON_KEY ? 'anon (insufficient — set SUPABASE_SERVICE_ROLE_KEY)' : 'none'),
    lastSyncAt,
    lastError
  };
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

export function userMirrorPayload(user) {
  if (!user) return null;
  return {
    id: user.id, email: user.email, name: user.name ?? null, username: user.username ?? null,
    dob: user.dob ?? null, phone: user.phone ?? null,
    address: user.address ?? null, role: user.role ?? null, user_type: user.user_type ?? null, company: user.company ?? null,
    goal: user.goal ?? null, language: user.language ?? 'en', country: user.country ?? null,
    tos_accepted: !!user.tos_accepted, email_verified: !!user.email_verified,
    phone_verified: !!user.phone_verified, avatar_color: user.avatar_color ?? null,
    created_at: user.created_at, updated_at: user.updated_at ?? new Date().toISOString(),
    deleted_at: user.deleted_at ?? null
  };
}

export function mirrorUser(user) {
  const payload = userMirrorPayload(user);
  if (!payload) return;
  return mirror(() => upsert('users', [payload]));
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
