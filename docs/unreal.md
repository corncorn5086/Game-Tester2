# Ember + Unreal Engine

## Setup

```bash
cd /path/to/UnrealProject       # the folder containing <Game>.uproject
ember init                      # detects Unreal via the .uproject file
```

Recommended `ember.config.json`:

```json
{
  "engine": "unreal",
  "logsPath": "Saved/Logs",
  "crashReportsPath": "Saved/Crashes",
  "sourcePaths": ["Source", "Config", "Plugins"],
  "includeExtensions": [".cpp", ".h", ".cs", ".ini"],
  "ignorePaths": ["Binaries", "Intermediate", "DerivedDataCache", "Saved", ".git"],
  "buildCommand": "RunUAT BuildCookRun -project=MyGame.uproject -build -cook -stage -unattended",
  "testCommand": "UnrealEditor-Cmd MyGame.uproject -ExecCmds=\"Automation RunTests MyGame\" -unattended -nopause -log"
}
```

## Logs & crashes

- Runtime/editor logs: `Saved/Logs/<ProjectName>.log`
- Crash dumps: `Saved/Crashes/` — point `crashReportsPath` there; any dump raises a critical signal.

## What Ember detects in Unreal projects (today)

- **Logs:** `Fatal error`, `Assertion failed`, `Access violation`, `LogOutOfMemory`,
  `Ensure condition failed`, Blueprint runtime errors, shader compile errors, `LogNet` errors.
- **Code:** immediate dereference of `Cast<>()` results, unchecked raw allocations,
  heavy `Tick` overrides, empty catch blocks, hardcoded secrets, TODO/FIXME, god files.

## Automation tests

The `test` check wraps Unreal's Automation framework
(`Automation RunTests <filter>`); failures surface via exit code and log parsing.
Gauntlet integration is on the roadmap.

## Roadmap

- Unreal plugin exposing an Ember automation bridge
- Gauntlet test orchestration
- Crash Reporter ingestion with symbolication
- Insights trace analysis for performance checks
