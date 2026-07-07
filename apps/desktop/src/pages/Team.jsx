import { useEffect, useState } from 'react';
import { Users, Send, Share2, Link2, Copy } from 'lucide-react';
import { TEAM_ROLES } from '@ember/shared/constants';
import { useApp } from '../lib/store.jsx';
import { Blocked } from '../components/common.jsx';

const ROLE_DESC = {
  owner: 'Full control, billing, delete workspace',
  admin: 'Manage members, projects and settings',
  developer: 'Run tests, edit configs, triage bugs',
  qa: 'Run tests, file and triage bugs',
  viewer: 'Read-only access to reports and bugs'
};

export default function Team() {
  const { api, backendHealth, toast, reports } = useApp();
  const [team, setTeam] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('developer');
  const online = backendHealth?.ok;

  useEffect(() => {
    if (online) api.team().then(setTeam).catch(() => setTeam(null));
  }, [api, online]);

  const invite = async () => {
    try {
      const res = await api.invite(email, role);
      toast('Invite stored', res.note ?? `${email} invited as ${role}`, 'ok');
      setEmail('');
      api.team().then(setTeam).catch(() => {});
    } catch (e) {
      toast('Invite failed', e.message, 'err');
    }
  };

  const report = reports[0] ?? null;
  const copySummary = () => {
    if (!report) return toast('No report to share', 'Generate a report first.', 'warn');
    navigator.clipboard.writeText(report.executiveSummary).then(() => toast('Copied', 'Report summary in clipboard', 'ok'));
  };

  return (
    <div>
      {!online && (
        <Blocked>
          Team features live on the Ember backend, which is not reachable right now. Start it with{' '}
          <code>npm run dev:backend</code> (or set the Backend URL in Settings). Nothing here is simulated while offline.
        </Blocked>
      )}

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3><Users size={15} color="var(--accent-soft)" /> Workspace members</h3>
          {online && team ? (
            <>
              <div style={{ marginTop: 12 }} className="row-list">
                {team.members.map((m) => (
                  <div key={m.id} className="row" style={{ cursor: 'default' }}>
                    <div className="grow">
                      <div className="title">{m.email}</div>
                      <div className="meta">{m.status} · invited {new Date(m.invitedAt).toLocaleDateString()}</div>
                    </div>
                    <span className="tag">{m.role}</span>
                  </div>
                ))}
                {team.members.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-faint)' }}>No members yet — invite your first teammate below.</div>}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <input className="input" style={{ flex: 1 }} placeholder="teammate@studio.gg" value={email} onChange={(e) => setEmail(e.target.value)} />
                <select className="input" style={{ width: 130 }} value={role} onChange={(e) => setRole(e.target.value)}>
                  {TEAM_ROLES.filter((r) => r !== 'owner').map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <button className="btn btn-primary btn-sm" disabled={!email.includes('@')} onClick={invite}><Send size={13} /> Invite</button>
              </div>
              <p style={{ marginTop: 10, fontSize: 11.5, color: 'var(--ink-faint)' }}>
                Invites are stored in the workspace. Email delivery is a placeholder until SMTP is configured.
              </p>
            </>
          ) : (
            <p style={{ marginTop: 12, fontSize: 13, color: 'var(--ink-faint)' }}>Backend offline — members appear here once connected.</p>
          )}
        </div>

        <div className="card">
          <h3>Permission levels</h3>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {TEAM_ROLES.map((r) => (
              <div key={r} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                <span className="tag" style={{ minWidth: 84, justifyContent: 'center' }}>{r}</span>
                <span style={{ fontSize: 12.5, color: 'var(--ink-dim)' }}>{ROLE_DESC[r]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3><Share2 size={15} color="var(--accent-soft)" /> Share</h3>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={copySummary}>
              <Copy size={13} /> Copy report summary
            </button>
            <button
              className="btn btn-ghost btn-sm"
              style={{ justifyContent: 'flex-start' }}
              disabled={!online || !report}
              title={!online ? 'Backend offline' : !report ? 'Generate a report first' : 'Create a public share link'}
              onClick={async () => {
                try {
                  await api.pushReport(null, report);
                  const res = await fetch(`${api.base}/reports/${report.id}/share`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ visibility: 'public' })
                  }).then((r) => r.json());
                  if (res.shareUrl) {
                    navigator.clipboard.writeText(api.base + res.shareUrl);
                    toast('Share link created', 'Public report URL copied to clipboard', 'ok');
                  }
                } catch (e) {
                  toast('Share failed', e.message, 'err');
                }
              }}
            >
              <Link2 size={13} /> Create public report link
            </button>
            <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
              Public links expose only the selected report (token URL). Private/workspace sharing follows role
              permissions once auth is enforced.
            </p>
          </div>
        </div>

        <div className="card">
          <h3>Activity log</h3>
          <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--ink-faint)', lineHeight: 1.6 }}>
            Workspace activity (runs, reports, invites, triage changes) is recorded in the backend's{' '}
            <code>agent_events</code> table — see Developer Tools → Agent events for the raw feed.
          </p>
        </div>
      </div>
    </div>
  );
}
