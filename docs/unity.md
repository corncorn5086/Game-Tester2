# Ember + Unity

## Setup

```bash
cd /path/to/UnityProject        # the folder containing Assets/ and ProjectSettings/
ember init                      # detects Unity (Assets + ProjectSettings + ProjectVersion.txt)
```

Recommended `ember.config.json` adjustments:

```json
{
  "engine": "unity",
  "logsPath": "Logs",
  "sourcePaths": ["Assets/Scripts"],
  "includeExtensions": [".cs", ".shader", ".asmdef"],
  "ignorePaths": ["Library", "Temp", "obj", "Logs", "UserSettings", ".git"],
  "buildCommand": "\"C:/Program Files/Unity/Hub/Editor/<version>/Editor/Unity.exe\" -batchmode -quit -projectPath . -buildTarget StandaloneWindows64 -executeMethod BuildScript.Build -logFile Logs/build.log",
  "testCommand": "\"…/Unity.exe\" -batchmode -runTests -projectPath . -testPlatform EditMode -testResults Logs/results.xml -logFile Logs/test.log"
}
```

## Where Unity logs live

- **Editor log:** `~/Library/Logs/Unity/Editor.log` (macOS) · `%LOCALAPPDATA%\Unity\Editor\Editor.log` (Windows)
- **Player log:** `~/Library/Logs/<Company>/<Product>/Player.log` · `%USERPROFILE%\AppData\LocalLow\<Company>\<Product>\Player.log`

Tip: pass `-logFile Logs/run.log` to any Unity invocation so everything lands inside
the project where `logsPath` points.

## What Ember detects in Unity projects (today)

- **Logs:** `NullReferenceException`, `MissingReferenceException`, `IndexOutOfRangeException`,
  `StackOverflowException`, `OutOfMemoryException`, `Fatal error`, missing script references, shader errors.
- **Code:** empty `catch {}`, `async void` methods, `GetComponent`/`Find` inside `Update`,
  scene-wide string lookups, collision handlers without null checks, unguarded `PlayerPrefs` reads,
  hardcoded secrets, TODO/FIXME density, god files, save systems without error handling.

## Running the test suite

Ember's `test` check wraps the [Unity Test Framework batch mode](https://docs.unity3d.com/Packages/com.unity.test-framework@latest);
failures surface via exit code and error lines in `Logs/test.log`.

## Roadmap for deeper Unity integration

- Unity package (UPM) with an in-editor Ember panel
- Play-mode input driver (controller/keyboard sweeps, fuzzing)
- Test Framework bridge (structured results instead of log parsing)
- Crash Reporting ingestion
