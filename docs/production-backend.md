# Public backend production checklist

This guide is hosting-provider neutral. Ember listens with plain HTTP inside the
runtime and expects a trusted reverse proxy or load balancer to terminate public
TLS.

## Required production configuration

Set these variables in the backend runtime, not in Desktop or a web bundle:

```dotenv
NODE_ENV=production
API_URL=https://api.example.com
EMBER_API_MODE=managed-ai
EMBER_DATA_DIR=/absolute/path/on/persistent-volume
EMBER_TRUST_PROXY=1
EMBER_CORS_ORIGINS=
EMBER_AI_PROVIDER=openai
OPENAI_API_KEY=replace-with-backend-secret
# Leave blank/false unless public onboarding is intentionally open:
EMBER_PUBLIC_SIGNUP=
```

- `API_URL` is the externally reachable HTTPS URL. Production startup rejects
  HTTP, embedded credentials, query strings and fragments.
- Public API URLs, non-loopback bind hosts (`0.0.0.0`, `::`, LAN/public hosts)
  and Railway runtime metadata are treated as exposure signals. If any is
  present while `NODE_ENV` is absent, misspelled or not `production`, startup
  is rejected before Ember can fall back to local `full` mode, wildcard CORS or
  development signup defaults.
- `EMBER_API_MODE=managed-ai` is mandatory for the current public deployment.
  It mounts only `/health`, `/auth/*` and `/ai/*`. The unaudited legacy project,
  agent, billing and platform routes remain available only in local `full` mode.
- `EMBER_DATA_DIR` must be an absolute, writable directory backed by persistent
  storage. SQLite, its WAL and session/account data live there. Production
  startup fails rather than silently writing into an ephemeral application
  directory.
- `EMBER_TRUST_PROXY` must describe the real proxy topology. `1` means exactly
  one proxy hop. Use an explicit hop count or comma-separated proxy IP/CIDR
  ranges when the topology differs. Production rejects `true` and `*` because
  trusting arbitrary forwarded addresses defeats IP-based abuse controls.
- An empty `EMBER_CORS_ORIGINS` disables cross-origin browser access while
  leaving same-origin requests, Desktop main-process requests and server clients
  unaffected. For a separate browser frontend, provide exact comma-separated
  origins such as `https://app.example.com,https://admin.example.com`.
  Wildcard CORS is rejected in production.
- Public signup is disabled unless `EMBER_PUBLIC_SIGNUP=true` is set exactly.
  Existing users can still sign in. Production responses never echo email or
  phone verification secrets.
- A fresh deployment must create its first verified operator with the one-time
  `/auth/bootstrap-operator` flow documented in `managed-ai-production.md`.
  Configure a server-only `EMBER_OPERATOR_BOOTSTRAP_SECRET` of at least 32
  characters plus the exact `EMBER_OPERATOR_BOOTSTRAP_EMAIL`, then delete both
  immediately after the successful claim. Never put this proof in Desktop.
- Email verification codes expire after ten minutes by default and have five
  persistent attempts. Forgot-password and resend routes have independent IP
  limits; issued credentials rotate in a globally capped `auth_tokens` table.

`HOST` defaults to `0.0.0.0` in production and `PORT` defaults to `4310`; most
runtimes inject `PORT`. `EMBER_SHUTDOWN_TIMEOUT_MS` defaults to 15000 and accepts
1000–120000 milliseconds.

## Managed AI

Production must select exactly one managed provider with
`EMBER_AI_PROVIDER=openai` or `EMBER_AI_PROVIDER=claude`; startup requires the
matching `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. `auto` remains a development
convenience only. Refusing provider fallback in production ensures one logical
request cannot fan out to two paid providers and escape exact budget accounting.
These credentials remain backend-only.

The backend never accepts a provider key from a client. Every paid `/ai/*`
operation requires an authenticated Ember session and is protected by request,
rate and concurrency limits.

## Storage and shutdown

Mount the persistent volume before starting Ember and back it up according to
the storage provider's SQLite guidance. On `SIGTERM` or `SIGINT`, Ember:

1. marks health as `shutting-down`;
2. stops accepting connections and drains active requests;
3. closes remaining connections after the configured deadline;
4. checkpoints the SQLite WAL and closes the database.

Give the process at least `EMBER_SHUTDOWN_TIMEOUT_MS` of termination grace.

## CORS and proxy verification

After deployment, verify from an allowed origin:

```bash
curl -i https://api.example.com/health \
  -H "Origin: https://app.example.com"
```

The response should echo that exact origin. An unlisted preflight should return
`403 CORS_ORIGIN_DENIED`. Never use `EMBER_TRUST_PROXY=true` merely to make a
forwarded address appear; match the actual number or address range of trusted
proxies.

## Local development

No production variables are required locally. Defaults remain:

```dotenv
NODE_ENV=development
API_URL=http://localhost:4310
EMBER_API_MODE=full
EMBER_CORS_ORIGINS=*
EMBER_TRUST_PROXY=false
HOST=127.0.0.1
```

Local SQLite stays at `backend/data/ember.sqlite` unless `EMBER_DATA_DIR` is set.
