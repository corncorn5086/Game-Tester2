import { useState } from 'react';
import { useApp } from '../lib/store.jsx';
import logo from '../assets/ember-logo.png';

/**
 * Auth: real backend signup/login when reachable; local-only and demo
 * entries always available. Sessions persist via settings.
 */
export default function Auth() {
  const { api, saveSettings, setPhase, toast, settings, backendHealth } = useApp();
  const [tab, setTab] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', pass: '', pass2: '', ws: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setError('');
    if (!form.email.includes('@')) return setError('Invalid email address.');
    if (form.pass.length < 8) return setError('Password must be at least 8 characters.');
    if (tab === 'signup' && form.pass !== form.pass2) return setError('Passwords do not match.');
    if (!backendHealth?.ok) {
      return setError('Backend unreachable — start it with `npm run dev:backend`, then try again.');
    }
    setBusy(true);
    try {
      const res = tab === 'login'
        ? await api.login(form.email, form.pass)
        : await api.signup(form.email, form.pass, form.name || undefined);
      await saveSettings({
        authToken: res.token,
        authEmail: form.email,
        session: { name: res.user?.name ?? form.email.split('@')[0], email: form.email, ws: res.workspace?.name ?? (form.ws || 'My Workspace'), kind: 'account' }
      });
      toast(tab === 'login' ? 'Signed in' : 'Account created');
      setPhase(settings.onboarded ? 'app' : 'onboarding');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };



  const input = (props) => <input className="input" {...props} />;

  return (
    <div className="full-center">
      <div className="anim-scale" style={{ width: 400, background: 'var(--bg-raise)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 18, padding: '36px 36px 28px', boxShadow: '0 40px 100px rgba(0,0,0,.7)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 28 }}>
          <img src={logo} alt="Ember" style={{ width: 56, filter: 'drop-shadow(0 0 14px rgba(255,90,20,.35))' }} />
          <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-.01em' }}>Welcome to Ember</div>
          <div style={{ fontSize: 12.5, color: 'rgba(244,244,245,.45)' }}>Autonomous QA for game studios</div>
        </div>

        <div className="seg" style={{ marginBottom: 22 }}>
          <button className={tab === 'login' ? 'on' : ''} style={{ flex: 1 }} onClick={() => { setTab('login'); setError(''); }}>Log in</button>
          <button className={tab === 'signup' ? 'on' : ''} style={{ flex: 1 }} onClick={() => { setTab('signup'); setError(''); }}>Sign up</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {tab === 'signup' && input({ placeholder: 'Name', value: form.name, onChange: set('name') })}
          {input({ placeholder: 'Email', value: form.email, onChange: set('email') })}
          {input({ placeholder: 'Password', type: 'password', value: form.pass, onChange: set('pass'), onKeyDown: (e) => e.key === 'Enter' && submit() })}
          {tab === 'signup' && input({ placeholder: 'Confirm password', type: 'password', value: form.pass2, onChange: set('pass2') })}
          {tab === 'signup' && input({ placeholder: 'Workspace name', value: form.ws, onChange: set('ws') })}
          {error && (
            <div style={{ fontSize: 12, color: '#f87171', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)', borderRadius: 8, padding: '9px 12px', lineHeight: 1.5 }}>
              {error}
            </div>
          )}
          <button className="btn btn-white" style={{ width: '100%', marginTop: 4 }} disabled={busy} onClick={submit}>
            {busy ? 'Working…' : tab === 'login' ? 'Log in' : 'Create account'}
          </button>
        </div>

      </div>
    </div>
  );
}
