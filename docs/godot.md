# Ember + Godot

## Setup

```bash
cd /path/to/godot-project       # the folder containing project.godot
ember init                      # detects Godot via project.godot
```

Recommended `ember.config.json`:

```json
{
  "engine": "godot",
  "logsPath": "logs",
  "sourcePaths": ["."],
  "includeExtensions": [".gd", ".cs", ".tscn", ".tres", ".cfg"],
  "ignorePaths": [".godot", ".import", "build", ".git"],
  "launchCommand": "godot --path . --log-file logs/run.log",
  "testCommand": "godot --headless -s addons/gut/gut_cmdln.gd",
  "buildCommand": "godot --headless --export-release \"Linux/X11\" build/game"
}
```

## Logging

Enable file logging in **Project Settings → Debug → File Logging**, or pass
`--log-file logs/run.log` on launch so `logsPath` has something to mine.

## What Ember detects in Godot projects (today)

- **Logs:** `ERROR:`, `SCRIPT ERROR`, `Invalid get index`,
  `Attempt to call function … on a null instance`, warnings.
- **Code (GDScript):** chained calls on `get_node()` without null-safety,
  per-frame `get_node()` lookups in `_process`, empty catch equivalents in C#,
  TODO/FIXME, unseeded RNG, save code without error handling.

## Test frameworks

The `test` check wraps [GUT](https://github.com/bitwes/Gut) or GdUnit via your
`testCommand`; a non-zero exit or error lines in output open bugs with evidence.

## Roadmap

- Godot addon (editor plugin) with an Ember dock
- GUT/GdUnit structured-result bridge
- Headless scene fuzzer (random input storms in exported builds)
