# Managed AI on Railway

This is the deployment runbook for Ember's public managed-AI backend. Provider
credentials belong to the Ember operator or its contracted provider. Customers
never enter a provider key, and no provider key is included in Ember Desktop.

The current public boundary is deliberately narrow: production must use
`EMBER_API_MODE=managed-ai`, which exposes `/health`, `/auth/*` and `/ai/*` but
does not mount the legacy project, agent, billing or platform routes.

## 1. Create the Railway service

1. Create a Railway project and add this Git repository as a service.
2. Keep the service root at the repository root. Do not set it to `backend`:
   `@ember/backend` depends on the sibling `@ember/agent` and `@ember/shared`
   npm workspaces.
3. Keep the config-as-code path at `/railway.json`. The checked-in manifest
   selects Railpack, builds only `@ember/backend`, starts that workspace, uses
   `/health`, requires `/data`, and fixes the service at one replica.
4. Use one region close to the customers. Do not add replicas while SQLite is
   the datastore.

Railpack reads the root lockfile and installs npm workspaces automatically. The
service variable `RAILPACK_NODE_VERSION=22` pins the runtime major required by
the built-in `node:sqlite` module.

## 2. Attach persistent storage before deploying

In the backend service, create one Railway Volume and mount it at exactly:

```text
/data
```

Set `EMBER_DATA_DIR=/data`. Ember stores `ember.sqlite`, its WAL files, accounts
and session state in this directory. The `requiredMountPath` guard
in `railway.json` intentionally prevents a production deployment without the
expected mount.

Railway allows only one volume per service and does not allow replicas with an
attached volume. A volume also means a brief interruption during redeployment;
`overlapSeconds` is therefore zero. `drainingSeconds` is 30 seconds so Ember's
15-second graceful shutdown has time to checkpoint and close SQLite.

## 3. Generate the HTTPS endpoint

Open **Service > Settings > Networking > Public Networking** and select
**Generate Domain**. Railway provisions and renews TLS automatically. Keep the
resulting `*.up.railway.app` endpoint or attach a custom domain later.

Do not define `PORT`; Railway injects it and uses the same value for the
healthcheck. Ember binds `0.0.0.0` in production.

## 4. Configure non-secret service variables

Add these variables to the backend service. `RAILWAY_PUBLIC_DOMAIN` is a
Railway-provided value, so `API_URL` stays synchronized with the generated
domain:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
RAILPACK_NODE_VERSION=22
API_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
EMBER_API_MODE=managed-ai
EMBER_DATA_DIR=/data
EMBER_TRUST_PROXY=loopback,linklocal,uniquelocal
EMBER_SHUTDOWN_TIMEOUT_MS=15000
EMBER_PUBLIC_SIGNUP=false
EMBER_AI_PROVIDER=openai
OPENAI_MODEL=gpt-5.6-terra
EMBER_AI_RATE_LIMIT_PER_MINUTE=12
EMBER_AI_IP_RATE_LIMIT_PER_MINUTE=24
EMBER_AI_CONCURRENCY_LIMIT=2
EMBER_AI_RATE_LIMIT_MAX_ENTRIES=10000
EMBER_AI_GLOBAL_CONCURRENCY_LIMIT=4
EMBER_AI_GLOBAL_OPERATIONS_PER_MINUTE=30
EMBER_AI_DAILY_USER_OPERATION_LIMIT=40
EMBER_AI_DAILY_GLOBAL_OPERATION_LIMIT=400
EMBER_AI_BUDGET_RETENTION_DAYS=8
EMBER_AUTH_SIGNUP_RATE_LIMIT=5
EMBER_AUTH_SIGNUP_RATE_WINDOW_MS=600000
EMBER_AUTH_LOGIN_RATE_LIMIT=15
EMBER_AUTH_LOGIN_RATE_WINDOW_MS=300000
EMBER_AUTH_FORGOT_PASSWORD_RATE_LIMIT=5
EMBER_AUTH_FORGOT_PASSWORD_RATE_WINDOW_MS=900000
EMBER_AUTH_RESEND_EMAIL_RATE_LIMIT=3
EMBER_AUTH_RESEND_EMAIL_RATE_WINDOW_MS=900000
EMBER_AUTH_OPERATOR_BOOTSTRAP_RATE_LIMIT=5
EMBER_AUTH_OPERATOR_BOOTSTRAP_RATE_WINDOW_MS=900000
EMBER_AUTH_RATE_LIMIT_MAX_ENTRIES=10000
EMBER_AUTH_SCRYPT_CONCURRENCY=2
EMBER_AUTH_SCRYPT_QUEUE_LIMIT=64
EMBER_AUTH_EMAIL_VERIFY_TTL_MS=600000
EMBER_AUTH_EMAIL_VERIFY_MAX_ATTEMPTS=5
EMBER_AUTH_PASSWORD_RESET_TTL_MS=1800000
EMBER_AUTH_PASSWORD_RESET_MIN_INTERVAL_MS=60000
EMBER_AUTH_TOKEN_MAX_ROWS=10000
```

`EMBER_TRUST_PROXY=loopback,linklocal,uniquelocal` trusts only private/local
proxy addresses and makes Express stop at the first public address while
walking the forwarded chain. This avoids assuming a fixed Railway hop count.
Do not use `true` or `*`. A real Railway topology and spoof-resistance check is
still mandatory before release; see the validation procedure below.

Leave `EMBER_CORS_ORIGINS` unset for Desktop-only access. Production then
allows requests without a browser `Origin` header but no cross-origin browser
site. If a separate web frontend needs the API, set this variable to its exact
HTTPS origin or comma-separated origins; never use `*` in production.

Set `OPENAI_MODEL=gpt-5.6-terra`; this is the current cost/quality default in
OpenAI's model catalog. Confirm that the exact model is enabled for the
operator project during the real provider smoke test. If Anthropic is the
contracted provider instead, set `EMBER_AI_PROVIDER=claude`, use only
`ANTHROPIC_API_KEY` in the next step, and verify the model IDs compiled in
`apps/agent/src/ai.js` before packaging; this build does not expose an
`ANTHROPIC_MODEL` runtime variable.

`EMBER_MANAGED_API_URL` is not a backend secret and is not required on Railway.
The same public HTTPS URL is embedded into the distributed Desktop build in
step 9.

The request and provider-operation limits are intentionally separate:

- `EMBER_AI_RATE_LIMIT_PER_MINUTE` and `EMBER_AI_CONCURRENCY_LIMIT` limit each
  authenticated account's HTTP requests;
- `EMBER_AI_GLOBAL_OPERATIONS_PER_MINUTE` and
  `EMBER_AI_GLOBAL_CONCURRENCY_LIMIT` limit paid provider operations across the
  single backend process;
- `EMBER_AI_DAILY_USER_OPERATION_LIMIT` and
  `EMBER_AI_DAILY_GLOBAL_OPERATION_LIMIT` are durable UTC-day budgets stored in
  SQLite on `/data`;
- one summary costs one operation and every bug triage costs one operation, so
  one `/ai/analyze` request with three triages can reserve four operations;
- daily usage rows older than `EMBER_AI_BUDGET_RETENTION_DAYS` are removed.

Authentication abuse controls are separate as well. Forgot-password and email
resend have independent IP windows. Email codes expire after ten minutes, stop
after five wrong attempts, and every resend invalidates the previous code.
Password-reset requests rotate at most once per minute for a known account.
`EMBER_AUTH_TOKEN_MAX_ROWS` caps the durable `auth_tokens` table; expired and
used rows are deleted during startup and issuance, and SQLite recycles their WAL
pages. Reaching the cap fails token issuance closed instead of growing storage.

Keep `numReplicas=1`: the global minute/concurrency guards are process-local,
while the daily counters and SQLite database are durable.

## 5. Seal the bootstrap proof and provider credential

Keep the same local PowerShell session through the bootstrap in step 6. Generate
a fresh 256-bit bootstrap secret locally; do not reuse a password or provider
key:

```powershell
$BootstrapBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($BootstrapBytes)
$BootstrapSecret = [Convert]::ToBase64String($BootstrapBytes)
$OperatorEmail = "operator@example.com"
```

In **Service > Variables**:

1. Add `EMBER_OPERATOR_BOOTSTRAP_EMAIL` with exactly `$OperatorEmail`.
2. Add `EMBER_OPERATOR_BOOTSTRAP_SECRET` with `$BootstrapSecret`. The backend
   rejects a configured secret shorter than 32 characters.
3. Add `OPENAI_API_KEY` with the operator-owned or contracted-provider value.
4. Apply the staged changes, then use each variable's three-dot menu to select
   **Seal**. Keep `$BootstrapSecret` only in the current local process until the
   one-time request in step 6 succeeds.
5. Confirm the sealed values are no longer retrievable through Railway.

For an Anthropic deployment, seal `ANTHROPIC_API_KEY` instead and do not add an
unused OpenAI key. Sealed variables remain available to the deployment but
cannot be read back through the UI or API. They are not copied automatically to
PR environments, duplicated environments or duplicated services.

An email allowlist is not an authentication proof and does not grant managed-AI
access. Production authorization always requires `email_verified=1`. The
one-time bootstrap is the only exception to normal email delivery: possession
of the high-entropy server proof creates the initial operator directly verified.

Never put a provider key in any of these locations:

- `railway.json`, `.env.example`, source control or a build command;
- `EMBER_MANAGED_API_URL`, `API_URL` or `--service-url`;
- Ember Desktop, an installer, a game project or `ember.config.json`.

## 6. Bootstrap the single operator account

Keep `EMBER_PUBLIC_SIGNUP=false` throughout this procedure. The dedicated
bootstrap route works only when there is no active user and no persistent
bootstrap marker. It creates the exact configured operator address directly as
verified, creates no session, and returns no bearer or provider credential.

After the deployment from step 5 is healthy, run:

```powershell
$ApiUrl = "https://YOUR-SERVICE.up.railway.app"
$SecurePassword = Read-Host "New Ember operator password" -AsSecureString
$OperatorPassword = [Net.NetworkCredential]::new('', $SecurePassword).Password
$Body = @{
  email = $OperatorEmail
  password = $OperatorPassword
  name = "Ember Operator"
  username = "ember_operator"
  tosAccepted = $true
} | ConvertTo-Json

$BootstrapResult = Invoke-RestMethod `
  -Method Post `
  -Uri "$ApiUrl/auth/bootstrap-operator" `
  -Headers @{ "X-Ember-Bootstrap-Secret" = $BootstrapSecret } `
  -ContentType "application/json" `
  -Body $Body

$BootstrapResult
$OperatorPassword = $null
$Body = $null
$BootstrapSecret = $null
```

The expected response has `bootstrapComplete: true` and a public user with
`emailVerified: true`; it has no `token`, bootstrap secret or provider key. A
wrong proof returns `OPERATOR_BOOTSTRAP_PROOF_INVALID`. Any replay while the
variables remain configured returns `OPERATOR_BOOTSTRAP_CLOSED` because the
singleton claim is durable on `/data`.

Immediately after success:

1. Delete `EMBER_OPERATOR_BOOTSTRAP_SECRET` and
   `EMBER_OPERATOR_BOOTSTRAP_EMAIL` from Railway and redeploy. Do not merely
   unseal them.
2. Confirm `EMBER_PUBLIC_SIGNUP=false`; a normal signup must return HTTP 403
   with `PUBLIC_SIGNUP_DISABLED`.
3. Sign in normally through Desktop with the operator email and password.
4. Confirm `/ai/status` reports `authenticated: true` and `authorized: true`.

Never send the bootstrap proof through the renderer, preload bridge, packaged
EXE, query string, logs or source control. It is not an OpenAI key and it must
not be retained after the one-time server claim. Anonymous and unverified
accounts always receive `authorized: false`; billable work is rejected before
any provider call.

## 7. Deploy and verify the public boundary

Deploy the staged changes. The deployment is healthy only after Railway gets
HTTP 200 from `/health`. From PowerShell, replace only the public hostname:

```powershell
$ApiUrl = "https://YOUR-SERVICE.up.railway.app"
curl.exe --fail-with-body "$ApiUrl/health"
curl.exe --fail-with-body "$ApiUrl/ai/status"
```

### Provider readiness smoke test

Each backend process performs exactly one small provider request during
startup. For OpenAI this uses the Responses API with `store: false`, a
16-output-token ceiling and the challenge `EMBER_OK`. Readiness succeeds only
when the normalized response is exactly `EMBER_OK`; extra prose is a failure.
The request has its own 20-second deadline, below Railway's 60-second
`healthcheckTimeout`.

The sanitized result is then retained in memory for the life of the process:

- `/health` and `/ai/status` only read that cached state and never call the
  provider;
- production `managed-ai` health returns HTTP 503 with `status: "not-ready"`
  while the probe is pending or failed, and HTTP 200 only after success;
- `/ai/status` keeps `enabled` and `authorized` false until the same successful
  probe, and paid routes fail closed before reaching the provider;
- responses expose only readiness state, provider/model after success and a
  timestamp. Provider response text, error details and credentials are
  discarded;
- there is no timer or automatic retry, so a bad credential cannot create a
  paid healthcheck loop. Correct the sealed key, provider or model and redeploy
  to run one new probe.

Budget one tiny provider request per backend deployment. A deployment that
never becomes healthy should be investigated as a provider configuration or
availability failure; do not increase Railway restart retries as a workaround.

Expected checks:

- `/health` returns `status: "ok"`, `service: "ember-backend"` and
  `ai.ready: true`;
- `/ai/status` returns `managed: true`, `enabled: true`, the configured provider
  and model, and no credential;
- an anonymous status request reports `authenticated: false` and
  `authorized: false`; this is expected because billable `/ai/*` operations
  require an approved Ember session.

Verify that full-mode routes are not exposed:

```powershell
curl.exe -i "$ApiUrl/projects"
```

The response must be `404`. A `200` response means the deployment is not using
the required managed-AI boundary.

Railway's healthcheck gates deployments but is not continuous uptime
monitoring. Add an independent HTTPS monitor for `/health` before a public
release.

### Validate the real Railway proxy chain

The `loopback,linklocal,uniquelocal` policy is safer than a guessed hop count,
but it still requires a real staging check on July 18, 2026:

1. Use a Railway staging environment with the same networking path and set a
   low temporary login limit, such as two attempts per minute.
2. From network A, trigger the login limiter. Repeat while sending different
   spoofed `X-Forwarded-For` values; changing that untrusted header must not
   bypass the same rate-limit bucket.
3. From an independent public network B, make one login attempt. It must not
   inherit network A's 429 response.
4. Restore the production limits and repeat one normal request from each
   network.

If spoofing bypasses the limiter, or independent networks share one bucket,
stop the release and replace the trust policy with a topology verified against
the live Railway headers. Do not log or persist raw client IP addresses during
this validation.

## 8. Enable SQLite backups

Open the service's **Backups** tab and enable all three Railway schedules:

- Daily: every 24 hours, retained for 6 days;
- Weekly: every 7 days, retained for 1 month;
- Monthly: every 30 days, retained for 3 months.

Railway's volume backups explicitly support SQLite. Backups are incremental
and billed at the same storage rate as volumes. Perform and document a restore
test before launch; a restore creates and mounts a replacement volume and then
redeploys the service. Wiping a volume also deletes its backups.

## 9. Package Ember Desktop with only the public URL

From the repository root, use the Windows packaging script that is actually
defined in `apps/desktop/package.json`:

```powershell
npm run dist:win -w @ember/desktop -- --service-url=https://YOUR-SERVICE.up.railway.app
```

The script accepts only the public HTTPS service URL, creates the allow-listed
`ember-service.json` resource for packaging, removes that temporary file after
the build, and strips provider-key variables from the child build environment.
The installers are written to `apps/desktop/release`.

Run the Desktop tests before distributing the installer:

```powershell
npm test -w @ember/desktop
```

The packaged app must connect with an Ember account session. It must never ask
the customer for an OpenAI or Anthropic credential.

## Official Railway references

- [Config as Code](https://docs.railway.com/config-as-code/reference)
- [Current `railway.json` schema](https://railway.com/railway.schema.json)
- [Deploying a monorepo](https://docs.railway.com/deployments/monorepo)
- [Node.js and npm workspaces in Railpack](https://railpack.com/languages/node/)
- [Variables and sealed variables](https://docs.railway.com/variables)
- [Public networking and automatic TLS](https://docs.railway.com/networking/public-networking)
- [Healthchecks](https://docs.railway.com/deployments/healthchecks)
- [Volumes](https://docs.railway.com/volumes/reference)
- [Volume backups](https://docs.railway.com/volumes/backups)
- [Restart policy](https://docs.railway.com/deployments/restart-policy)
