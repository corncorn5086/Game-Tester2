# Ember Agent — CLI reference

The `ember` command is a real, offline-first QA agent. It never invents results:
every number in its output is counted from files it scanned, patterns it matched,
logs it parsed or commands it executed.

## Commands

### `ember init`

Creates `ember.config.json` in the current directory.

```bash
ember init                       # auto-detects engine (Unity/Unreal/Godot/web/custom)
ember init --engine godot        # force an engine profile
ember init --name "Space Miner"  # set the project name
ember init --force               # overwrite an existing config
```

### `ember scan`

Inventories the project: file counts by extension, total size, largest files,
engine detection with evidence.

```bash
ember scan
ember scan --json                # also writes ember-scan.json
```

### `ember analyze`

Static code analysis over your configured `sourcePaths` / `includeExtensions`.
Findings carry file, line, matched code and a suggested fix.

```bash
ember analyze
ember analyze --limit 50         # show more findings
ember analyze --json             # writes ember-analysis.json
```

### `ember run`

Executes a test profile from `ember.config.json → testProfiles`.

```bash
ember run                        # profile "smoke" by default
ember run --profile full
```

- `agent` checks (scan/analyze/logs/regression) run in-process.
- `command` checks run your configured `buildCommand` / `testCommand` / `launchCommand`
  with a timeout; output is captured and error lines extracted.
- `integration` checks (controller input, save/load probes…) are reported as
  **blocked** until the matching engine SDK exists.
- Missing configuration is reported explicitly: `run command missing — set "buildCommand"…`

Exit code is non-zero when any check fails (CI-friendly).

### `ember report`

Collects fresh signals (scan + analyze + logs, optionally a profile), builds the
QA report, stores it in `.ember/reports/` and diffs it against the previous one.

```bash
ember report                     # JSON report
ember report --format md         # Markdown report
ember report --profile full      # include a full test-profile run
ember report --ai                # add an AI executive summary (requires ANTHROPIC_API_KEY)
```

Report contents: executive summary, professional metrics (bugs found, crash risk,
failed checks, severity breakdown, regression risk, build health, logs analyzed,
files scanned, commands executed…), full bug records, blockers, suggested tests,
recommended next actions, regression diff.

### `ember config validate`

Validates `ember.config.json` against the schema — exact errors and warnings,
exit 1 when invalid.

### `ember doctor`

Environment + configuration diagnostics: Node version, git, config presence,
every configured path (exists?), every command (set?), backend reachability.
Each failing check comes with a remedy.

## AI (optional)

Ember supports two interchangeable AI providers — Claude Fable 5 and OpenAI.
Set `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` (in `.env` or the environment)
to enable them. Pin one explicitly in Ember Desktop Settings → AI, or with
`--ai-provider claude|openai` on the CLI. Leave it on "Auto" (the default) to
try Claude Fable 5 first and automatically fall back to OpenAI if the call
fails (e.g. no credit, rate limit) — every attempt is a real API call, never
a simulated one. Two features, never anything else, never silently:

- **Bug explanations** — root-cause hypothesis + a concrete fix suggestion,
  grounded strictly in the bug's real evidence (desktop app: "Explain with AI"
  in the bug drawer).
- **Report executive summaries** — a short leadership-facing summary written
  from the report's real metrics (`ember report --ai`, or "Generate AI summary"
  in the desktop Reports view).

Without a configured key, both features report an explicit not-configured
state — Ember never fabricates an AI response. Get a Claude key at
[console.anthropic.com](https://console.anthropic.com) → Settings → API Keys,
or an OpenAI key at [platform.openai.com](https://platform.openai.com/api-keys).
`ember doctor` reports whether AI is enabled and which provider is active.

## Backend sync (optional)

If `backend.url` is set in the config (or `API_URL` in the environment), `scan`,
`analyze` and `report` push their results after finishing. Authentication uses
`backend.token` or the `EMBER_AGENT_TOKEN` environment variable. Sync failures
never break the local run.

## Files Ember writes

| Path | Contents |
|---|---|
| `ember.config.json` | Your project's Ember configuration |
| `.ember/runs/` | Raw test-run records |
| `.ember/reports/` | Stored reports (used for regression diffs) |
| `ember-report-*.json` / `.md` | Exported reports |

Add `.ember/` to your game's `.gitignore` if you don't want run history in git.
