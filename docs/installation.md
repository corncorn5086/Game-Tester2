# Installing Ember

Ember ships as three pieces that share one core:

| Piece | What it is | Install |
|---|---|---|
| **Ember Agent** (CLI) | The real QA agent — scans, analyzes, runs commands, writes reports | `npm link --workspace @ember/agent` |
| **Ember Desktop** | Premium command center UI around the same agent core | `npm run dev:desktop` (Electron) |
| **Ember Backend** | API for projects, bugs, reports, team, billing | `npm run dev:backend` |

## Prerequisites

- Node.js **22.5+** (the backend uses the built-in `node:sqlite`; the agent alone works on Node 20+)
- Git (optional but recommended)

## Full setup from source

```bash
git clone https://github.com/corncorn5086/Game-Tester2
cd Game-Tester2
npm install
```

### 1. Install the CLI (Ember Agent)

```bash
npm link --workspace @ember/agent
ember --help
```

This puts a real `ember` executable on your PATH. It is fully offline-first — no account, no backend, no network required.

### 2. Run Ember Desktop

```bash
npm run dev:desktop          # Vite renderer + Electron shell
# or, renderer only (browser preview, limited: no filesystem access):
npm run dev:desktop:renderer
```

> The first `npm install` downloads the Electron binary. In restricted environments set
> `ELECTRON_SKIP_BINARY_DOWNLOAD=1` and use the browser preview + CLI instead.

### 3. Run the backend (optional)

```bash
cp .env.example .env         # fill in what you need; nothing is required for local use
npm run dev:backend          # http://localhost:4310
curl http://localhost:4310/health
```

Data lives in `backend/data/ember.sqlite` (SQLite). The storage layer is isolated in
`backend/src/db.js` so it can be swapped for Postgres/Supabase later (`DATABASE_URL` is reserved for that).

### 4. Run the web site

```bash
npm run dev:web              # http://localhost:4311
```

## Building the desktop installer (.exe / .dmg / AppImage)

Ember Desktop packages into a native installer with **electron-builder**
(config: `apps/desktop/electron-builder.yml`). The renderer is built with Vite
first, then the Electron app — including the bundled Ember agent core — is
packaged.

```bash
# from the repo root, after npm install
npm run dist:win    -w @ember/desktop     # Windows: NSIS installer + portable .exe
npm run dist:mac    -w @ember/desktop     # macOS: .dmg
npm run dist:linux  -w @ember/desktop     # Linux: AppImage
npm run dist        -w @ember/desktop     # current platform's default target
```

Output lands in `apps/desktop/release/`. The Windows build produces a normal
double-click **`Ember Setup <version>.exe`** installer (choose install folder,
desktop + start-menu shortcuts) plus a no-install **portable** `.exe`.

Notes:
- The first run downloads the Electron binary and electron-builder's platform
  tools. On a restricted/CI machine that blocks those downloads, packaging
  fails at the download step — run it on a normal dev machine (build the
  Windows installer on Windows for a signed, wine-free result).
- Icons come from `apps/desktop/build-resources/icon.png` (1254×1254).
- Code signing is off by default. For a trusted, SmartScreen-clean installer,
  add your certificate via the standard electron-builder `win.certificateFile`
  / `CSC_LINK` settings before shipping publicly.

## Connecting Ember to a game

See [game-integration.md](./game-integration.md), then the engine guides:
[Unity](./unity.md) · [Unreal](./unreal.md) · [Godot](./godot.md) · [Web games](./web-games.md)

## Everything at once

```bash
npm run dev:all              # backend + web + desktop renderer
```

## Ember Cloud (Supabase)

The repo ships pre-wired to a Supabase project (`.env` at the root — the
publishable key is safe to expose). Start the backend and it syncs
automatically:

```bash
npm run dev:backend
curl http://localhost:4310/cloud/health   # {"ok":true}
```

Admin account (workspace **Ember HQ**): `corncorn508@gmail.com` (owner).
Rotate the temporary password after first login. To point at your own
Supabase project, change `SUPABASE_URL`/`SUPABASE_ANON_KEY` in `.env` and
apply the migrations from the Supabase dashboard (schema in
`backend/src/db.js`, cloud flavor in the project's migration history).
