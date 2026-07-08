# Security & privacy

Ember is built local-first so studios keep control of their code.

## Guarantees today

- **Local-first**: the Ember Agent CLI works fully offline; cloud sync only
  happens when you configure `backend.url` (desktop) / `API_URL` (CLI). Analysis,
  scans and reports all run on your machine.
- **Code never uploaded**: agent sync pushes *metrics and findings* (scan stats,
  finding messages, log excerpts) — never file contents. The "Do not upload code"
  setting reflects this and will gate any future feature that would need source.
- **Secret masking**: before anything is stored or synced, log lines and command
  output pass through a masker that redacts API keys, bearer tokens, Stripe/GitHub/AWS
  key shapes and JWTs (`apps/agent/src/util.js → maskSecrets`).
- **Secret detection in your code**: the `hardcoded-secret` analysis rule flags
  credentials committed to source as **critical** findings.
- **No keys in the repo**: all credentials come from `.env` (see `.env.example`);
  billing/AI provider fields in the app are placeholders that store nothing remotely.
- **Passwords**: scrypt-hashed with per-user salts and constant-time comparison;
  sessions are opaque random tokens with expiry.
- **Path privacy**: demo data and exports strip absolute machine paths; privacy mode
  extends this to all exports.

## Controls in Ember Desktop → Settings

- Cloud sync toggle · Privacy mode · Mask secrets · Do not upload code
- Data retention (days) for local run history
- Clear local cache · Export settings (secrets always excluded)

## Planned

- Export **all** data / delete account endpoints (GDPR-style)
- Workspace audit log surfaced in the UI
- Private/on-prem deployment guide (Enterprise)
- Role-enforced API authorization on every route

## Supabase (Ember Cloud) — production RLS

The backend mirrors reports, bugs, events, projects and team invites to a
Supabase project when `SUPABASE_URL` and a Supabase key are set (see
`backend/src/supabase.js`). SQLite stays the local source of truth; cloud
failures never break local operation.

**Security model — backend-mediated, deny-by-default.** The Ember backend is the
only Supabase client. It authenticates with the **service-role key**
(`SUPABASE_SERVICE_ROLE_KEY`), which bypasses RLS. Every application table has
RLS **enabled with no policies**, and direct `anon`/`authenticated` grants are
revoked (migration `ember_production_rls_lockdown`). Result:

- The public (publishable/anon) key has **no access to any table** — it can no
  longer read `users.password_hash`, projects, reports or anything else. Verified:
  a PostgREST call with the anon key returns `401 permission denied`.
- Only the service-role key (held server-side, never shipped to the desktop/web
  client) can read or write. The Supabase security advisor reports **no ERROR
  or WARN** findings — only INFO "RLS enabled, no policy", which is the intended
  state for this model.
- The former `SECURITY DEFINER` view (`members_directory`) was dropped.

**Setup:** put your service-role key (Supabase → Settings → API → `service_role`)
in `.env` as `SUPABASE_SERVICE_ROLE_KEY`. If only the anon key is present, the
backend logs a warning and cloud sync is denied by the database — it never
silently falls back to an insecure state. `GET /health` reports which key is in
use (`cloudStatus.auth`).

**Next step (multi-tenant direct client access):** if you later let the desktop
app talk to Supabase directly (instead of only through the backend), migrate app
auth to Supabase Auth and add per-workspace policies keyed on `auth.uid()`
before granting the authenticated role any table access. Until then, deny-by-
default + service-role backend is the correct, locked-down posture.
