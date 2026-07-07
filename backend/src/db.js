/**
 * Storage layer. Default driver: SQLite via node:sqlite (zero native deps).
 * The rest of the backend only talks to the exported helpers, so migrating
 * to Postgres/Supabase later means reimplementing this module only
 * (DATABASE_URL in .env is reserved for that).
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = process.env.EMBER_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'ember.sqlite'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT,
    password_hash TEXT, created_at TEXT NOT NULL, settings_json TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT REFERENCES users(id),
    created_at TEXT NOT NULL, settings_json TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    user_id TEXT REFERENCES users(id), email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer',
    status TEXT NOT NULL DEFAULT 'invited', invited_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, workspace_id TEXT REFERENCES workspaces(id),
    name TEXT NOT NULL, engine TEXT NOT NULL DEFAULT 'custom', path TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, config_json TEXT DEFAULT '{}',
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS connected_sources (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
    kind TEXT NOT NULL, location TEXT NOT NULL, created_at TEXT NOT NULL, meta_json TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS test_plans (
    id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id),
    name TEXT NOT NULL, description TEXT, checks_json TEXT NOT NULL DEFAULT '[]',
    commands_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS test_runs (
    id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), test_plan_id TEXT REFERENCES test_plans(id),
    profile TEXT, status TEXT NOT NULL DEFAULT 'queued', started_at TEXT, finished_at TEXT,
    created_at TEXT NOT NULL, summary_json TEXT DEFAULT '{}', steps_json TEXT DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), test_run_id TEXT REFERENCES test_runs(id),
    source TEXT, created_at TEXT NOT NULL, content_json TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS bugs (
    id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), test_run_id TEXT,
    title TEXT NOT NULL, description TEXT, severity TEXT NOT NULL, category TEXT NOT NULL,
    source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', evidence TEXT,
    reproducibility TEXT, regression_risk TEXT, suggested_fix TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, detail_json TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), test_run_id TEXT,
    generated_at TEXT NOT NULL, summary TEXT, metrics_json TEXT DEFAULT '{}', report_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_events (
    id TEXT PRIMARY KEY, project_id TEXT, kind TEXT NOT NULL, created_at TEXT NOT NULL, payload_json TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS billing_customers (
    id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), stripe_customer_id TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY, workspace_id TEXT REFERENCES workspaces(id), plan_id TEXT NOT NULL DEFAULT 'free',
    status TEXT NOT NULL DEFAULT 'active', stripe_subscription_id TEXT,
    current_period_end TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS usage_events (
    id TEXT PRIMARY KEY, workspace_id TEXT, kind TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, meta_json TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS exports (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, format TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'completed',
    created_at TEXT NOT NULL, payload_json TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS imports (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'completed',
    created_at TEXT NOT NULL, payload_json TEXT DEFAULT '{}', result_json TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS shared_reports (
    id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id),
    visibility TEXT NOT NULL DEFAULT 'private', share_token TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, user_id TEXT, workspace_id TEXT, type TEXT NOT NULL,
    title TEXT NOT NULL, body TEXT, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bugs_project ON bugs(project_id);
  CREATE INDEX IF NOT EXISTS idx_reports_project ON reports(project_id);
  CREATE INDEX IF NOT EXISTS idx_runs_project ON test_runs(project_id);
  `
];

for (const migration of MIGRATIONS) db.exec(migration);

// --- tiny helpers ---

export function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

export function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

export function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

export function j(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function now() {
  return new Date().toISOString();
}
