# Ember + web games (Phaser, PixiJS, Three.js, Babylon…)

## Setup

```bash
cd /path/to/web-game            # the folder containing package.json
ember init                      # detects web via package.json game frameworks
```

Recommended `ember.config.json`:

```json
{
  "engine": "web",
  "logsPath": "logs",
  "sourcePaths": ["src"],
  "includeExtensions": [".js", ".ts", ".jsx", ".tsx", ".html", ".css"],
  "ignorePaths": ["node_modules", "dist", "build", ".git"],
  "buildCommand": "npm run build",
  "testCommand": "npm test",
  "launchCommand": "npm run dev"
}
```

## Capturing browser logs

Browsers don't write files, so give Ember something to read. Two easy options:

1. **Playwright harness** — capture console + page errors into `logs/`:

```js
page.on('console', (m) => log(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => log(`Uncaught ${e.message}`));
```

2. **Dev-server tee** — pipe your dev server output: `npm run dev 2>&1 | tee logs/dev.log`

## What Ember detects in web games (today)

- **Logs:** `Uncaught TypeError/ReferenceError`, null/undefined property access,
  stack overflows, WebGL context loss, missing assets (404), `[Violation]` perf entries.
- **Code:** `JSON.parse(localStorage.getItem(...))` without guards, empty catch blocks,
  `setInterval`-based game loops, unhandled promise chains, hardcoded secrets.

## Roadmap

- Playwright-driven gameplay runner: real input fuzzing in a real browser,
  screenshots on failure, deterministic seeds
- `ember-sdk` (JS/TS) for in-game event/error reporting
- GitHub Action wrapping `ember run` + report upload
