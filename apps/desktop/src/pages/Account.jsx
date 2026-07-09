import { useEffect, useMemo, useState } from 'react';
import { User, Pencil, Lock, ShieldCheck, LifeBuoy, Check, Mail, Phone, LogOut, Monitor, Camera, Download, AlertTriangle, X } from 'lucide-react';
import { useApp } from '../lib/store.jsx';
import { bridge } from '../lib/bridge.js';

const SECTIONS = [
  ['profile', 'Profile', User],
  ['edit', 'Edit my info', Pencil],
  ['password', 'Change password', Lock],
  ['security', 'Account security', ShieldCheck],
  ['support', 'Support', LifeBuoy]
];

const ROLES = ['Solo developer', 'Studio / team lead', 'QA engineer', 'Producer', 'Publisher', 'Hobbyist', 'Other'];

export default function Account() {
  const { user, refreshUser, api, toast, logout, moduleParam } = useApp();
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
          {user && section === 'profile' && <ProfileView user={user} initials={initials} refreshUser={refreshUser} api={api} toast={toast} />}
          {user && section === 'edit' && <EditInfo user={user} api={api} refreshUser={refreshUser} toast={toast} />}
          {user && section === 'password' && <ChangePassword api={api} toast={toast} />}
          {user && section === 'security' && <Security user={user} api={api} refreshUser={refreshUser} toast={toast} logout={logout} />}
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

function ProfileView({ user, initials, refreshUser, api, toast }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const changePhoto = async () => {
    setErr('');
    const res = await bridge.selectImage();
    if (!res || res.error) { if (res?.error) setErr(res.error); return; }
    setBusy(true);
    try {
      await api.updateProfile({ avatar: res.dataUrl });
      await refreshUser();
      toast('Profile photo updated');
    } catch (e) { setErr(e.data?.error ?? e.message); }
    finally { setBusy(false); }
  };

  const removePhoto = async () => {
    setBusy(true);
    try { await api.updateProfile({ avatar: null }); await refreshUser(); toast('Profile photo removed'); }
    catch (e) { setErr(e.data?.error ?? e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="acct-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <div style={{ position: 'relative', flex: 'none' }}>
          <div className="avatar" style={{ width: 64, height: 64, fontSize: 21, background: user.avatarColor || '#ff4d00' }}>
            {user.avatarData ? <img src={user.avatarData} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : initials}
          </div>
          <button className="avatar-edit-btn" title="Change photo" disabled={busy} onClick={changePhoto}>
            <Camera size={12} />
          </button>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{user.name || user.username || user.email}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>@{user.username ?? '—'} · joined {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button type="button" className="auth-link" style={{ fontSize: 11 }} onClick={changePhoto}>{busy ? 'Uploading…' : 'Change photo'}</button>
            {user.avatarData && <button type="button" className="auth-link" style={{ fontSize: 11, color: 'var(--ink-faint)' }} onClick={removePhoto}>Remove</button>}
          </div>
        </div>
        {user.emailVerified
          ? <span className="chip ok">verified</span>
          : <span className="chip dim">unverified</span>}
      </div>
      {err && <div className="auth-err" style={{ marginBottom: 16 }}>{err}</div>}
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

function Security({ user, api, refreshUser, toast, logout }) {
  const [busy, setBusy] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [devCode, setDevCode] = useState(null);
  const [err, setErr] = useState('');
  const [sessions, setSessions] = useState(null);
  const [showDeactivate, setShowDeactivate] = useState(false);
  const [deactivatePw, setDeactivatePw] = useState('');
  const [deactivateErr, setDeactivateErr] = useState('');

  const loadSessions = () => api.sessions().then(setSessions).catch(() => setSessions([]));
  useEffect(() => { loadSessions(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    try { await api.revokeOtherSessions(); toast('Signed out of all other devices'); await loadSessions(); }
    catch (e) { setErr(e.data?.error ?? e.message); } finally { setBusy(''); }
  };
  const revokeOne = async (id) => {
    setBusy(`revoke-${id}`);
    try { await api.revokeSession(id); await loadSessions(); toast('Session signed out'); }
    catch (e) { setErr(e.data?.error ?? e.message); } finally { setBusy(''); }
  };

  const exportData = async () => {
    setBusy('export'); setErr('');
    try {
      const data = await api.exportData();
      const f = await bridge.file.saveAs({ title: 'Export my data', defaultPath: 'ember-my-data.json', content: JSON.stringify(data, null, 2) });
      if (f) toast(`Exported ${f}`);
    } catch (e) { setErr(e.data?.error ?? e.message); }
    finally { setBusy(''); }
  };

  const deactivate = async () => {
    setDeactivateErr('');
    if (!deactivatePw) return setDeactivateErr('Enter your password to confirm.');
    setBusy('deactivate');
    try {
      await api.deactivateAccount(deactivatePw);
      toast('Account deactivated');
      logout();
    } catch (e) { setDeactivateErr(e.data?.error ?? e.message); }
    finally { setBusy(''); }
  };

  return (
    <div className="acct-panel">
      <h3>Account security</h3>
      <div className="sub">Verify your identity, control active sessions and manage your data.</div>

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

      <div style={{ padding: '13px 0', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: sessions?.length ? 10 : 0 }}>
          <Monitor size={16} color="var(--accent-soft)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Active sessions</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>{sessions ? `${sessions.length} active` : 'Loading…'}</div>
          </div>
          {sessions?.length > 1 && (
            <button className="btn btn-ghost btn-sm" disabled={busy === 'revoke'} onClick={revoke}>{busy === 'revoke' ? 'Working…' : 'Sign out others'}</button>
          )}
        </div>
        {sessions?.map((s) => (
          <div className="session-row" key={s.id}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.current ? 'var(--ok)' : 'rgba(255,255,255,.2)', flex: 'none' }} />
            <div style={{ flex: 1, fontSize: 11.5, color: 'var(--ink-dim)' }}>
              {s.current ? 'This device' : 'Other device'} · signed in {new Date(s.createdAt).toLocaleString()}
            </div>
            {!s.current && (
              <button className="btn btn-ghost btn-xs" disabled={busy === `revoke-${s.id}`} onClick={() => revokeOne(s.id)}>Sign out</button>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 0' }}>
        <Download size={16} color="var(--accent-soft)" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Export my data</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>Download your profile, workspace and subscription as JSON.</div>
        </div>
        <button className="btn btn-ghost btn-sm" disabled={busy === 'export'} onClick={exportData}>{busy === 'export' ? 'Exporting…' : 'Export'}</button>
      </div>

      {err && <div className="auth-err" style={{ marginTop: 14 }}>{err}</div>}

      <div className="danger-zone">
        <h4><AlertTriangle size={14} /> Danger zone</h4>
        <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginBottom: 12 }}>
          Deactivating disables sign-in immediately. Your workspace history stays intact for teammates.
        </div>
        {!showDeactivate ? (
          <button className="btn btn-danger btn-sm" onClick={() => setShowDeactivate(true)}>Deactivate account</button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 340 }}>
            <div className="field"><label>Confirm your password</label>
              <input className="input" type="password" value={deactivatePw} onChange={(e) => setDeactivatePw(e.target.value)} />
            </div>
            {deactivateErr && <div className="auth-err">{deactivateErr}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-danger btn-sm" disabled={busy === 'deactivate'} onClick={deactivate}>{busy === 'deactivate' ? 'Deactivating…' : 'Confirm deactivation'}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowDeactivate(false); setDeactivateErr(''); setDeactivatePw(''); }}><X size={13} /> Cancel</button>
            </div>
          </div>
        )}
      </div>
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
