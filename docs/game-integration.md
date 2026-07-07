# Plugging Ember into a game project

Ember's integration strategy is deliberately layered — each layer works on its own,
and each deeper layer unlocks more checks. Nothing is ever simulated: a check that
needs a layer you haven't installed reports as **blocked**, with the exact missing piece.

## Layer 1 — `ember.config.json` (works today)

One JSON file at your project root describes your game to Ember:

```json
{
  "projectName": "My Game",
  "engine": "unity",
  "logsPath": "Logs",
  "buildCommand": "Unity -batchmode -quit -projectPath . -executeMethod BuildScript.Build",
  "testCommand": "Unity -batchmode -runTests -projectPath . -testResults results.xml",
  "sourcePaths": ["Assets/Scripts"],
  "testProfiles": {
    "smoke": { "checks": ["scan", "analyze", "logs"] },
    "full":  { "checks": ["scan", "analyze", "logs", "build", "test"] }
  }
}
```

`ember init` generates this file with engine detection and per-engine defaults.
Full field reference: [config.md](./config.md).

## Layer 2 — Ember Agent CLI (works today)

```bash
cd /path/to/your/game
ember init
ember doctor                 # verifies paths, commands, environment
ember run --profile smoke    # scan + static analysis + log mining
ember report --format md     # professional QA report + regression diff
```

What is real today:

- **File scan** — walks your project, honors ignore lists, detects the engine from real markers.
- **Static analysis** — 20+ game-specific heuristics (empty catch, async void, per-frame lookups,
  unchecked save loads, hardcoded secrets…) plus your own regex rules (`customRules`).
- **Log mining** — engine-specific crash/error patterns (NullReferenceException, Fatal error,
  SCRIPT ERROR, Uncaught TypeError…), deduplicated with occurrence counts and context lines.
- **Command execution** — your build/test/launch commands run with timeouts; exit codes and
  error lines become evidence.
- **Reports & regression** — every report is stored in `.ember/reports`; the next report diffs
  against it: *fixed / still present / new*.

## Layer 3 — Ember Desktop (works today)

The desktop app reads and edits the same config, runs the same agent core over IPC,
streams live run steps, and adds triage, exports and team features.

## Layer 4 — Backend sync (works today, optional)

Set in `ember.config.json`:

```json
"backend": { "url": "http://localhost:4310", "projectId": "" }
```

(or `API_URL` / `EMBER_AGENT_TOKEN` environment variables). The agent then pushes scans,
analyses and reports; bugs land in the shared triage board.

## Layer 5 — CI/CD (manual recipe today)

```yaml
# GitHub Actions sketch
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- run: npm install && npm link --workspace @ember/agent
- run: ember run --profile smoke      # non-zero exit on failed checks
- run: ember report --format json
- uses: actions/upload-artifact@v4
  with: { name: ember-report, path: ember-report-*.json }
```

A first-class GitHub Action is on the roadmap.

## Layer 6 — Engine SDKs (roadmap)

These unlock in-game checks (input driving, save/load probes, collision sweeps,
scripted scenarios, performance capture):

- Unity package (UPM) with editor panel + play-mode bridge
- Unreal plugin (Gauntlet/Automation bridge)
- Godot addon (editor dock + headless scene runner)
- Web runner (Playwright-driven input fuzzing, console capture)
- JS/TS, C#, Python SDKs for custom engines

Until an SDK is installed, checks that need one are reported as
`blocked — requires engine SDK`, never faked.
