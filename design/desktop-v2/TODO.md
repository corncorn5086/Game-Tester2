# Ember Desktop — TODO

## Done in this prototype
- Splash (animated checks, particles, real logo)
- Auth: login / signup / local-only / demo, validation states, local session
- Onboarding wizard (8 steps: welcome, workflow, engine, folder, config, agent check, first scan, finish)
- Command Dock (no left sidebar) + Command Palette (⌘K)
- Mode indicator: Real / Demo / Local-only / Not connected
- Command Center: agent core, panels, 10 metrics, activity, recommended + quick actions, empty state
- Connectors page (5 real MVP + placeholders with "coming soon" explanations)
- Agent Setup: terminal output, 6 CLI commands simulated
- Code Analysis: animated scan, severity summary, 8 issue types, Create bug
- Logs Viewer: filters, 4 levels, Create bug from log
- Live Run: step tracker, streaming logs, issue pulses, missing-requirements guard
- Bug board (3 columns) + detail panel (evidence, steps, fix, mark fixed, copy)
- Reports: library + document viewer, real JSON + Markdown export (download)
- Settings: 7 collapsible sections
- Local persistence (session, mode, project, issues, bugs, reports)

## Remaining (desktop/Electron build)
- Native folder picker + real file scanning (main process)
- Real ember CLI execution via IPC (never from renderer)
- Config Editor full page (tabs: General/Engine/Paths/Commands/Test Profiles/Rules/Advanced) — Zod validation
- Test Plan Builder page (check cards, profiles, import/export)
- Projects grid page (multi-project)
- Export/Import utility page (settings, test plans, bug lists)
- Account / Billing / Team / Share pages
- Developer Tools diagnostics page
- Backend client (health, sync) + status display
- SQLite or app-data JSON store replacing localStorage
- PDF report export
- Secret masking in log parser
