# ◆ Ember — autonomous QA agent for game studios

**Ember** plugs into your game project, scans the codebase, mines the logs, runs your build
and test commands, and hands you a professional QA report with reproducible bugs and
suggested fixes. It is built for studios, indie developers and QA teams — and it never
fakes a result: every number is counted from real signals, and anything Ember cannot do
yet is reported as **blocked** with the exact missing piece.

> Monorepo: marketing site · desktop app · backend API · installable local agent (CLI) · shared schemas · docs.

## What's inside

```
apps/web        Ember marketing site (Vite + React) — presents & distributes the product
apps/desktop    Ember Desktop (Electron) — ships the v3 desktop design as a native app
apps/agent      Ember Agent — real, offline-first CLI (`ember`), zero external deps
backend         Ember API (Express + SQLite via node:sqlite) — projects, bugs, reports, auth, billing, team
shared          Schemas, engine profiles, plans, constants shared by everything
docs            Developer documentation (installation, integrations, CLI, config…)
design          Original Claude Design handoff (visual reference for the web site)
```

## Quick start

Requires **Node 22.5+**.

```bash
git clone https://github.com/corncorn5086/Game-Tester2
cd Game-Tester2
npm install
```

| What | Command | URL |
|---|---|---|
| Web site | `npm run dev:web` | http://localhost:4311 |
| Desktop app (Electron) | `npm run dev:desktop` | native window |
| Backend API | `npm run dev:backend` | http://localhost:4310 |
| Web + backend together | `npm run dev:all` | 4311 + 4310 |
| Agent CLI | `npm run agent -- --help` | — |

The desktop app is a native Electron window that serves the bundled **v3 design**
(`apps/desktop/standalone/`, with React/Babel vendored locally so it runs offline).
Launch it separately with `npm run dev:desktop`.

Other scripts: `build:web` / `build:desktop` / `build:backend` / `build:agent`,
`lint`, `typecheck`, `test:agent`, and `npm test --workspace @ember/backend`.

## Install Ember Agent (the CLI)

```bash
npm link --workspace @ember/agent    # puts `ember` on your PATH

cd /path/to/your/game
ember init                           # detects Unity/Unreal/Godot/web/custom, writes ember.config.json
ember doctor                         # verifies paths, commands, environment
ember scan                           # inventory + engine detection
ember analyze                        # static analysis (real findings with file:line evidence)
ember run --profile smoke            # run a test profile
ember report --format md             # professional QA report + regression diff
```

## Connecting a game project

Ember integrates in layers — config file → CLI → desktop app → backend sync → CI → engine SDKs.
See [docs/game-integration.md](docs/game-integration.md) and the engine guides:
[Unity](docs/unity.md) · [Unreal](docs/unreal.md) · [Godot](docs/godot.md) · [Web games](docs/web-games.md).

### Example `ember.config.json`

```json
{
  "projectName": "My Game",
  "engine": "unity",
  "logsPath": "Logs",
  "crashReportsPath": "CrashReports",
  "sourcePaths": ["Assets/Scripts"],
  "buildCommand": "Unity -batchmode -quit -projectPath . -executeMethod BuildScript.Build",
  "testCommand": "Unity -batchmode -runTests -projectPath . -testResults results.xml",
  "testProfiles": {
    "smoke": { "checks": ["scan", "analyze", "logs"] },
    "full":  { "checks": ["scan", "analyze", "logs", "build", "test"] }
  },
  "customRules": [],
  "backend": { "url": "http://localhost:4310" }
}
```

Full reference: [docs/config.md](docs/config.md) · CLI reference: [docs/cli.md](docs/cli.md).

## What is real today

- **File scanning & engine detection** — real markers (Assets/, .uproject, project.godot, package.json deps).
- **Static code analysis** — 20+ game-specific heuristics + your custom regex rules; every finding cites file, line and code.
- **Log mining** — engine-specific crash/error patterns, deduplicated with occurrence counts and context.
- **Command execution** — configured build/test/launch commands run with timeouts; exit codes and error lines become evidence.
- **Bug records** — severity, category, source, evidence, repro steps, reproducibility confidence, regression risk, status.
- **QA reports** — executive summary + professional metrics (bugs found, crash risk, failed checks, severity breakdown, build health, logs analyzed, files scanned, commands executed…), JSON & Markdown export, run-over-run regression diff (fixed / still present / new).
- **Backend** — full REST API with SQLite storage, real auth (scrypt + session tokens), report ingestion into a shared triage board, notifications, usage metrics counted from the database.
- **Desktop app (v3 design)** — the Ember Desktop v3 design running as a native Electron app, now wired to real signals end-to-end: sign-in/sign-up against the backend (with explicit ToS consent), native **Open Folder** picker + strict project validation (evidence shown before anything is written), real agent runs over a narrow IPC bridge with live step streaming, and reports built from the agent's actual metrics and file:line findings. Served over a local HTTP loopback with React/ReactDOM/Babel **vendored locally** (`apps/desktop/standalone/vendor/`) — no CDN dependency. In a plain browser preview (no Electron), folder picking and runs are honestly **blocked**, never simulated.
- **Strict project validation** — the shared `ProjectValidator` refuses system/drive roots, home and media folders, dependency/build/cache directories, empty or media-only folders; it requires real engine markers or source evidence before `ember init`, any scan, or any report (`shared/src/project-validator.js`).

## Data modes — no fake results

- **Real mode** — a project with a valid `ember.config.json` is connected; everything comes from your files, logs and commands.
- **Not connected** — honest empty states with an onboarding checklist.
- Checks that need an engine SDK (input driving, save/load probes…) are reported as **blocked**, never simulated.
- Folders that fail validation produce **no scan, no report and no config** — only the reasons why.

## Accounts, billing, team

- **Accounts**: signup/login/logout with scrypt-hashed passwords and bearer sessions (`/auth/*`); profile & per-user settings; verification/reset codes go to the **server log only** (never API responses) until SMTP exists — `EMBER_DEV_CODES=1` opts into dev-mode responses.
- **API security**: every private route requires auth; the workspace always comes from the session, never from the client; auth endpoints are rate limited; CORS is a loopback + `CORS_ORIGINS` allowlist (no `*`).
- **Billing**: Free / Pro ($29/mo) / Studio ($99/mo) / **Annual ($500/yr)** / **Lifetime ($2,500 one-time)** / Enterprise — single source of truth in `shared/src/plans.js`. Checkout mints a server-side **payment intent** (workspace + plan bound before any window opens; idempotent, replay-safe activation). PayPal Orders and Braintree one-time sales are wired for sandbox keys; **recurring subscription cycles and webhooks are not built yet** — without keys, checkout returns an explicit 501 ([docs/billing.md](docs/billing.md)).
- **Team**: workspaces, roles (owner/admin/developer/qa/viewer), invites, public report share links ([docs/team.md](docs/team.md)).
- **Export/import**: reports (JSON/Markdown; PDF planned), bugs, settings, config, test plans — plus backend `/exports` & `/imports`.
- **Security**: on-device analysis, secret masking, secret detection in code, no keys in the repo ([docs/security.md](docs/security.md)).

Copy `.env.example` to `.env` for backend configuration. Never commit real keys.

## Current limitations (honest)

- Engine SDKs (Unity package, Unreal plugin, Godot addon, web runner) are not published — gameplay-level checks report as blocked. The AI does not yet *play* the game; it analyzes code, logs and command output.
- Recurring billing is not finished: PayPal/Braintree handle real one-time sandbox payments through server-side intents, but subscription lifecycles (renewals, webhooks, dunning, invoices, customer portal) are not built.
- SMTP email, Slack/Discord notifications and PDF export are placeholders with explicit UI/API states; verification codes land in the server log meanwhile.
- Object-level RBAC is partial: routes require auth and derive the workspace server-side, but per-role permissions (owner/admin/developer/qa/viewer) are not enforced on every object yet.
- The desktop Terminal tab (real PTY), MFA/passkeys, legal pages and the iPhone companion described in the product plan are not built yet.
- Desktop binaries are not yet published to GitHub Releases; run from source meanwhile.
- Static analysis is heuristic (regex-based) — a real signal source, not a full parser; AST-based analyzers are on the roadmap.

## Roadmap (next steps)

1. Playwright-based web game runner — first real *gameplay* automation (input fuzzing, console capture, screenshots).
2. PayPal Subscriptions + Braintree recurring billing with verified webhooks, invoices and a customer portal.
3. Role-enforced (RBAC) API authorization on every object; MFA (TOTP) and session/device management UI.
4. Real PTY Terminal tab in the desktop app (node-pty + xterm.js) with per-command risk confirmation for AI-proposed commands.
5. Versioned legal pages (Terms, Privacy, AI & Data Processing, Refund, Acceptable Use) with recorded consent.
6. Electron-builder packaging + published desktop binaries on Releases.
7. Unity UPM package (editor panel + play-mode bridge), then Unreal/Godot; AST-based analyzers (Roslyn / ts-morph).

## Documentation

[Installation](docs/installation.md) · [Game integration](docs/game-integration.md) · [CLI](docs/cli.md) · [Config](docs/config.md) · [Unity](docs/unity.md) · [Unreal](docs/unreal.md) · [Godot](docs/godot.md) · [Web games](docs/web-games.md) · [Billing](docs/billing.md) · [Team](docs/team.md) · [Security](docs/security.md)

---

© 2026 Ember Labs — forged for game makers.
