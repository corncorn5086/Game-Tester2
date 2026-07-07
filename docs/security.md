# Security & privacy

Ember is built local-first so studios keep control of their code.

## Guarantees today

- **Local-only mode** (default in Ember Desktop): the app never contacts the backend.
  The CLI works fully offline; sync only happens if you configure `backend.url`.
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

- Local-only mode · Privacy mode · Mask secrets · Do not upload code
- Data retention (days) for local run history
- Clear local cache · Export settings (secrets always excluded)

## Planned

- Export **all** data / delete account endpoints (GDPR-style)
- Workspace audit log surfaced in the UI
- Private/on-prem deployment guide (Enterprise)
- Role-enforced API authorization on every route

## Supabase (Ember Cloud) — current dev posture

The backend mirrors reports, bugs, events, projects and team invites to a
Supabase project when `SUPABASE_URL` + `SUPABASE_ANON_KEY` are set (see
`backend/src/supabase.js`). SQLite stays the local source of truth; cloud
failures never break local operation.

**Dev-mode RLS warning:** the current Row Level Security policies allow the
publishable (anon) key to read/write the app tables so the backend can sync
without a service key. This is fine for a private dev project, but before any
public deployment you must: (1) move writes behind the service-role key kept
server-side only, (2) replace the permissive policies with per-workspace
policies keyed on `auth.uid()`, and (3) migrate app auth to Supabase Auth.
