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
- **Desktop app (v3 design)** — the Ember Desktop v3 design running as a native Electron app: onboarding/auth screens, Command Center, Projects, Connect, Agent, Analyze, Run, Bugs, Reports and Settings, with the animated molten-core orb. It is served over a local HTTP loopback with React/ReactDOM/Babel and the 3D runtime **vendored locally** (`apps/desktop/standalone/vendor/`), so it renders offline with no CDN dependency. This is a visual/interactive design build; the real agent core (scans, reports) is exposed through the CLI and backend.

## Data modes — no fake results

- **Real mode** — a project with a valid `ember.config.json` is connected; everything comes from your files, logs and commands.
- **Demo mode** — opt-in, clearly labeled; shows a report generated by a real agent run on a bundled sample project.
- **Not connected** — honest empty states with an onboarding checklist.
- Checks that need an engine SDK (input driving, save/load probes…) are reported as **blocked**, never simulated.

## Accounts, billing, team

- **Accounts**: signup/login/logout with scrypt-hashed passwords and bearer sessions (`/auth/*`); profile & per-user settings; forgot-password is a placeholder until SMTP exists.
- **Billing**: Free / Pro ($29) / Studio ($99) / Enterprise plans; full API surface; **Stripe is not wired yet** — checkout returns an explicit 501 until `STRIPE_*` keys are set in `.env` ([docs/billing.md](docs/billing.md)).
- **Team**: workspaces, roles (owner/admin/developer/qa/viewer), invites, public report share links ([docs/team.md](docs/team.md)).
- **Export/import**: reports (JSON/Markdown; PDF planned), bugs, settings, config, test plans — plus backend `/exports` & `/imports`.
- **Security**: local-only mode, secret masking, secret detection in code, no keys in the repo ([docs/security.md](docs/security.md)).

Copy `.env.example` to `.env` for backend configuration. Never commit real keys.

## Current limitations (honest)

- Engine SDKs (Unity package, Unreal plugin, Godot addon, web runner) are not published — gameplay-level checks report as blocked.
- Stripe, SMTP email, Slack/Discord notifications and PDF export are placeholders with explicit UI states.
- Auth exists but is not yet enforced on every backend route (local-first default).
- Desktop binaries are not yet published to GitHub Releases; run from source meanwhile.
- Static analysis is heuristic (regex-based) — a real signal source, not a full parser; AST-based analyzers are on the roadmap.

## Roadmap (next steps)

1. Playwright-based web game runner — first real *gameplay* automation (input fuzzing, console capture, screenshots).
2. GitHub Action + PR annotations for `ember run`.
3. Electron-builder packaging + published desktop binaries on Releases.
4. Stripe checkout + webhooks; role-enforced API authorization.
5. Unity UPM package (editor panel + play-mode bridge), then Unreal/Godot.
6. AST-based analyzers (C# via Roslyn sidecar, TS via ts-morph) to deepen code analysis.

## Documentation

[Installation](docs/installation.md) · [Game integration](docs/game-integration.md) · [CLI](docs/cli.md) · [Config](docs/config.md) · [Unity](docs/unity.md) · [Unreal](docs/unreal.md) · [Godot](docs/godot.md) · [Web games](docs/web-games.md) · [Billing](docs/billing.md) · [Team](docs/team.md) · [Security](docs/security.md)

---

© 2026 Ember Labs — forged for game makers.
