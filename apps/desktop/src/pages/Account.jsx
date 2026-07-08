import { useEffect, useMemo, useState } from 'react';
import { User, Pencil, Lock, ShieldCheck, Plug, LifeBuoy, Check, Mail, Phone, LogOut, Monitor } from 'lucide-react';
import { useApp } from '../lib/store.jsx';
import { bridge } from '../lib/bridge.js';

const SECTIONS = [
  ['profile', 'Profile', User],
  ['edit', 'Edit my info', Pencil],
  ['password', 'Change password', Lock],
  ['security', 'Account security', ShieldCheck],
  ['integrations', 'Integrations', Plug],
  ['support', 'Support', LifeBuoy]
];

const ROLES = ['Solo developer', 'Studio / team lead', 'QA engineer', 'Producer', 'Publisher', 'Hobbyist', 'Other'];

export default function Account() {
  const { user, refreshUser, api, toast, logout, moduleParam, backendHealth } = useApp();
  const [section, setSection] = useState('profile');

  useEffect(() => { if (moduleParam && SECTIONS.some((s) => s[0] === moduleParam)) setSection(moduleParam); }, [moduleParam]);

  const initials = useMemo(() => {
    const n = user?.name || user?.email || '?';
    return n.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  }, [user]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '6px 0 18px' }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: '-.02em' }}>Account</h2>
        <span className="micro-mono">{user?.email ?? 'not signed in'}</span>
      </div>

      <div className="acct-wrap">
        <div className="acct-nav">
          {SECTIONS.map(([id, label, Icon]) => (
            <button key={id} className={section === id ? 'on' : ''} onClick={() => setSection(id)}>
              <span className="an-ic"><Icon size={15} /></span>{label}
            </button>
          ))}
          <button className="danger" style={{ color: 'var(--err)', marginTop: 6 }} onClick={logout}>
            <span className="an-ic" style={{ color: 'var(--err)' }}><LogOut size={15} /></span>Sign out
          </button>
        </div>

        <div>
          {!user && <div className="acct-panel">Sign in to manage your account.</div>}
          {user && section === 'profile' && <ProfileView user={user} initials={initials} />}
          {user && section === 'edit' && <EditInfo user={user} api={api} refreshUser={refreshUser} toast={toast} />}
          {user && section === 'password' && <ChangePassword api={api} toast={toast} />}
          {user && section === 'security' && <Security user={user} api={api} refreshUser={refreshUser} toast={toast} />}
          {user && section === 'integrations' && <Integrations api={api} backendHealth={backendHealth} />}
          {user && section === 'support' && <Support />}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '11px 0', borderBottom: '1px solid var(--line)' }}>
      <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{label}</span>
      <span style={{ fontSize: 12.5, color: 'var(--ink)', textAlign: 'right' }}>{value || '—'}</span>
    </div>
  );
}

function ProfileView({ user, initials }) {
  return (
    <div className="acct-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <div className="avatar" style={{ width: 54, height: 54, fontSize: 19, background: user.avatarColor || '#ff4d00' }}>{initials}</div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{user.name || user.username || user.email}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>@{user.username ?? '—'} · joined {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}</div>
        </div>
        {user.emailVerified
          ? <span className="chip ok" style={{ marginLeft: 'auto' }}>verified</span>
          : <span className="chip dim" style={{ marginLeft: 'auto' }}>unverified</span>}
      </div>
      <Row label="Full name" value={user.name} />
      <Row label="Username" value={user.username ? `@${user.username}` : null} />
      <Row label="Email" value={user.email} />
      <Row label="Phone" value={user.phone} />
      <Row label="Date of birth" value={user.dob} />
      <Row label="Address" value={user.address} />
      <Row label="Role" value={user.role} />
      <Row label="Company / project" value={user.company} />
      <Row label="Goal with Ember" value={user.goal} />
    </div>
  );
}

function useForm(initial) {
  const [v, setV] = useState(initial);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  return [v, set, setV];
}

function EditInfo({ user, api, refreshUser, toast }) {
  const [v, set] = useForm({
    name: user.name ?? '', username: user.username ?? '', phone: user.phone ?? '',
    dob: user.dob ?? '', address: user.address ?? '', role: user.role ?? '', company: user.company ?? '', goal: user.goal ?? ''
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);

  const save = async () => {
    setErr(''); setOk(false); setBusy(true);
    try {
      await api.updateProfile(v);
      await refreshUser();
      setOk(true); toast('Profile updated');
    } catch (e) { setErr(e.data?.error ?? e.message); }
    finally { setBusy(false); }
  };

  const field = (label, k, props = {}) => (
    <div className="field"><label>{label}</label>
      {props.select
        ? <select className="input" value={v[k]} onChange={set(k)}><option value="">—</option>{props.select.map((o) => <option key={o} value={o}>{o}</option>)}</select>
        : <input className="input" type={props.type ?? 'text'} placeholder={props.ph} value={v[k]} onChange={set(k)} />}
    </div>
  );

  return (
    <div className="acct-panel">
      <h3>Edit my information</h3>
      <div className="sub">Changes are saved to your account and synced to the cloud.</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {field('Full name', 'name')}
        {field('Username', 'username')}
        {field('Phone', 'phone')}
        {field('Date of birth', 'dob', { type: 'date' })}
        {field('Role', 'role', { select: ROLES })}
        {field('Company / project', 'company')}
      </div>
      <div className="field" style={{ marginTop: 14 }}><label>Address</label>
        <textarea className="input" rows={2} value={v.address} onChange={set('address')} />
      </div>
      <div className="field" style={{ marginTop: 14 }}><label>Goal with Ember</label>
        <input className="input" value={v.goal} onChange={set('goal')} />
      </div>
      {err && <div className="auth-err" style={{ marginTop: 14 }}>{err}</div>}
      {ok && <div className="acct-ok" style={{ marginTop: 14 }}>Saved ✓</div>}
      <button className="btn btn-fire" style={{ marginTop: 18 }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
    </div>
  );
}

function ChangePassword({ api, toast }) {
  const [v, set] = useForm({ cur: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);

  const strong = (p) => p.length >= 8 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p);

  const save = async () => {
    setErr(''); setOk(false);
    if (!strong(v.next)) return setErr('New password must be 8+ chars with an uppercase, a lowercase and a number.');
    if (v.next !== v.confirm) return setErr('New passwords do not match.');
    setBusy(true);
    try {
      await api.changePassword(v.cur, v.next);
      setOk(true); set('cur')({ target: { value: '' } }); set('next')({ target: { value: '' } }); set('confirm')({ target: { value: '' } });
      toast('Password changed — other sessions were signed out');
    } catch (e) { setErr(e.data?.error ?? e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="acct-panel">
      <h3>Change password</h3>
      <div className="sub">For your security, changing your password signs out all other devices.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 360 }}>
        <div className="field"><label>Current password</label><input className="input" type="password" value={v.cur} onChange={set('cur')} /></div>
        <div className="field"><label>New password</label><input className="input" type="password" value={v.next} onChange={set('next')} /><span className="hint">8+ chars, upper + lower + number</span></div>
        <div className="field"><label>Confirm new password</label><input className="input" type="password" value={v.confirm} onChange={set('confirm')} /></div>
        {err && <div className="auth-err">{err}</div>}
        {ok && <div className="acct-ok">Password changed ✓</div>}
        <button className="btn btn-fire" disabled={busy} onClick={save}>{busy ? 'Updating…' : 'Update password'}</button>
      </div>
    </div>
  );
}

function Security({ user, api, refreshUser, toast }) {
  const [busy, setBusy] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [devCode, setDevCode] = useState(null);
  const [err, setErr] = useState('');

  const sendEmail = async () => {
    setErr(''); setBusy('email');
    try { const r = await api.resendEmailCode(); setDevCode(r.verifyCode); toast('Verification code sent'); }
    catch (e) { setErr(e.data?.error ?? e.message); } finally { setBusy(''); }
  };
  const confirmEmail = async () => {
    setErr(''); setBusy('email2');
    try { await api.verifyEmail(emailCode); await refreshUser(); toast('Email verified'); setDevCode(null); setEmailCode(''); }
    catch (e) { setErr(e.data?.error ?? 'Invalid code'); } finally { setBusy(''); }
  };
  const revoke = async () => {
    setBusy('revoke');
    try { await api.revokeOtherSessions(); toast('Signed out of all other devices'); }
    catch (e) { setErr(e.data?.error ?? e.message); } finally { setBusy(''); }
  };

  return (
    <div className="acct-panel">
      <h3>Account security</h3>
      <div className="sub">Verify your identity and control active sessions.</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 0', borderBottom: '1px solid var(--line)' }}>
        <Mail size={16} color="var(--accent-soft)" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Email verification</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>{user.email}</div>
        </div>
        {user.emailVerified
          ? <span className="chip ok">verified</span>
          : <button className="btn btn-ghost btn-sm" disabled={busy === 'email'} onClick={sendEmail}>{busy === 'email' ? 'Sending…' : 'Send code'}</button>}
      </div>

      {!user.emailVerified && devCode && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Enter the 6-digit code</label>
            <input className="input" placeholder="123456" value={emailCode} onChange={(e) => setEmailCode(e.target.value)} />
            <span className="hint" style={{ fontFamily: 'var(--font-mono)' }}>dev (no email transport): {devCode}</span>
          </div>
          <button className="btn btn-fire btn-sm" disabled={busy === 'email2'} onClick={confirmEmail}>Verify</button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 0', borderBottom: '1px solid var(--line)' }}>
        <Phone size={16} color="var(--accent-soft)" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Phone verification</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>{user.phone || 'No phone on file — add one in Edit my info'}</div>
        </div>
        {user.phoneVerified ? <span className="chip ok">verified</span> : <span className="chip dim">optional</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 0' }}>
        <Monitor size={16} color="var(--accent-soft)" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Active sessions</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>Sign out everywhere except this device.</div>
        </div>
        <button className="btn btn-ghost btn-sm" disabled={busy === 'revoke'} onClick={revoke}>{busy === 'revoke' ? 'Working…' : 'Sign out others'}</button>
      </div>

      {err && <div className="auth-err" style={{ marginTop: 14 }}>{err}</div>}
    </div>
  );
}

function Integrations({ api, backendHealth }) {
  const [status, setStatus] = useState({});
  useEffect(() => {
    (async () => {
      const out = {};
      try { out.ai = await bridge.agent.aiStatus(); } catch { /* ignore */ }
      try { out.providers = await api.paymentProviders(); } catch { /* ignore */ }
      try { out.cloud = await api.health(); } catch { /* ignore */ }
      setStatus(out);
    })();
  }, [api]);

  const item = (name, on, detail) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>{detail}</div>
      </div>
      <span className={`chip ${on ? 'ok' : 'dim'}`}>{on ? 'connected' : 'not connected'}</span>
    </div>
  );

  return (
    <div className="acct-panel">
      <h3>Connected integrations</h3>
      <div className="sub">Services Ember talks to. Keys live in .env, never in the app.</div>
      {item('Ember Backend', !!backendHealth?.ok, backendHealth?.ok ? `Healthy · v${backendHealth.version}` : 'Offline — start it with npm run dev:backend')}
      {item('Ember Cloud (Supabase)', !!status.cloud?.ok, status.cloud?.ok ? 'Cloud sync healthy' : 'Add SUPABASE_SERVICE_ROLE_KEY to enable')}
      {item('AI provider', !!status.ai?.enabled, status.ai?.enabled ? `${status.ai.label} (${status.ai.model})` : 'Add ANTHROPIC_API_KEY or OPENAI_API_KEY')}
      {(status.providers ?? []).map((p) => (
        <div key={p.id}>{item(p.label, p.available, p.note)}</div>
      ))}
    </div>
  );
}

function Support() {
  return (
    <div className="acct-panel">
      <h3>Support & help</h3>
      <div className="sub">We're here to help you ship a stable game.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <a className="auth-choice" href="mailto:hello@ember.dev">
          <span className="ac-ic"><Mail size={17} /></span>
          <span style={{ flex: 1 }}><span className="ac-t">Email support</span><div className="ac-d">hello@ember.dev — we reply within a business day</div></span>
        </a>
        <a className="auth-choice" href="https://github.com/corncorn5086/Game-Tester2" target="_blank" rel="noreferrer">
          <span className="ac-ic"><LifeBuoy size={17} /></span>
          <span style={{ flex: 1 }}><span className="ac-t">Documentation</span><div className="ac-d">Guides, CLI reference and engine integration</div></span>
        </a>
      </div>
      <div style={{ marginTop: 18, fontSize: 11.5, color: 'var(--ink-faint)', lineHeight: 1.6 }}>
        Ember Desktop {typeof window !== 'undefined' && window.ember?.desktop ? '(desktop shell)' : '(browser preview)'} · report bugs and request features on GitHub.
      </div>
    </div>
  );
}
