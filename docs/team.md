# Team & collaboration

## Model

- **Workspace** — the unit of collaboration and billing. Created automatically with each account.
- **Team members** — rows in `team_members` with a role and status (`invited` / `active`).
- **Roles** — `owner`, `admin`, `developer`, `qa`, `viewer`:

| Role | Can |
|---|---|
| owner | Everything, billing, delete workspace |
| admin | Manage members, projects, settings |
| developer | Run tests, edit configs, triage bugs |
| qa | Run tests, file & triage bugs |
| viewer | Read-only reports and bugs |

## What works today

- `GET /team` — members + roles
- `POST /team/invite` — stores the invite, raises a `teammate-invited` notification
  (email delivery is a placeholder until SMTP is configured)
- Accounts: `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET/PATCH /auth/me`
  — real scrypt-hashed passwords and bearer session tokens
- Shared reports: `POST /reports/:id/share` (public token link → `GET /shared/:token`)
- Activity: every agent push is recorded in `agent_events`

## What's next

- Enforcing role permissions on every route (middleware exists; policies pending)
- Email invitations (SMTP), invitation acceptance flow
- Per-project permissions and shared test plans
- SSO / SCIM for Enterprise
