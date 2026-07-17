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
- **No provider keys in clients**: OpenAI/Anthropic credentials exist only in
  the Ember backend environment (see `.env.example`). Ember Desktop never asks
  for, stores, receives, or bundles a provider key. Managed AI requests pass
  through an authenticated Ember API route with request-size limits.
- **Account session, not provider credential**: Desktop keeps only the user's
  Ember session token in the operating-system encrypted vault. The renderer and
  project configuration never receive that token; Electron's trusted main
  process attaches it to managed requests.
- **Explicit external review**: deterministic QA remains local. When the user
  enables Deep AI for a run, Ember sends only the report metrics and redacted
  finding evidence required for that review — never the provider credential and
  never complete source files. A local report is still preserved if AI is
  unavailable, rejected, timed out, or cancelled.
- **Passwords**: scrypt-hashed with per-user salts and constant-time comparison;
  sessions are opaque random tokens with expiry.
- **Account proofs are bounded**: email codes use cryptographic randomness,
  expire quickly, stop after a persistent attempt limit, and rotate on resend.
  Recovery/resend routes are independently rate-limited and `auth_tokens` has
  durable cleanup plus a fail-closed row cap.
- **One-time operator bootstrap**: the first verified production account needs
  an exact configured email and a server-only secret of at least 32 characters.
  A durable singleton blocks replay; the bootstrap returns no session and the
  secret is removed from hosting immediately afterward. An email allowlist by
  itself never authorizes managed AI.
- **Path privacy**: demo data and exports strip absolute machine paths; privacy mode
  extends this to all exports.

## Controls in Ember Desktop → Settings

- Cloud sync toggle · Privacy mode · Mask secrets · Do not upload code
- Data retention (days) for local run history
- Clear local cache · Export settings (secrets always excluded)
- Managed AI service status (provider credentials are controlled by Ember)

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

- Password verifiers are never mirrored to Supabase at all. The public
  (publishable/anon) key also has **no access to any table**; a direct PostgREST
  call with the anon key returns `401 permission denied`.
- Only the service-role key (held server-side, never shipped to the desktop/web
  client) can read or write. The Supabase security advisor reports **no ERROR
  or WARN** findings — only INFO "RLS enabled, no policy", which is the intended
  state for this model.
- The former `SECURITY DEFINER` view (`members_directory`) was dropped.

**Setup:** put your service-role key (Supabase → Settings → API → `service_role`)
in `.env` as `SUPABASE_SERVICE_ROLE_KEY`. If only the anon key is present, the
backend logs a warning and cloud sync is denied by the database — it never
silently falls back to an insecure state. In local `full` mode, `GET /health`
reports which key is in use (`cloudStatus.auth`); public `managed-ai` health
responses omit cloud integration details.

For distributed Desktop builds, the release operator passes the non-secret
public backend URL through `--service-url=https://…`. The packaging script
validates HTTPS and embeds it as a small allow-listed resource containing only
`schemaVersion` and `serviceUrl`. The installed app never asks the customer for
an environment variable, and editable project configuration cannot redirect
account or managed-AI traffic. Provider keys stay only in the backend
environment. Development uses `http://localhost:4310` explicitly.

## Public backend boundary

Production startup requires `EMBER_API_MODE=managed-ai`. This fail-closed mode
mounts only health, account authentication and managed-AI routes; the legacy
project, agent, billing and platform routers are not exposed. Production also
requires an external HTTPS `API_URL`, an explicit trusted-proxy topology and an
absolute persistent `EMBER_DATA_DIR`. Wildcard CORS and trust-all proxy settings
are rejected. See [production-backend.md](./production-backend.md).

**Next step (multi-tenant direct client access):** if you later let the desktop
app talk to Supabase directly (instead of only through the backend), migrate app
auth to Supabase Auth and add per-workspace policies keyed on `auth.uid()`
before granting the authenticated role any table access. Until then, deny-by-
default + service-role backend is the correct, locked-down posture.
