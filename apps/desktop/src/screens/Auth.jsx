import { useState } from 'react';
import { LogIn, UserPlus, ArrowLeft, ArrowRight, Check, ShieldCheck, Mail, Phone } from 'lucide-react';
import { useApp } from '../lib/store.jsx';
import { LANGUAGES } from '../lib/i18n.js';
import LanguageSelect from '../components/LanguageSelect.jsx';
import logo from '../assets/ember-logo.png';

/**
 * Ember authentication flow — accounts only, connected to the backend,
 * fully localized. welcome → (login | 4-step signup | forgot) → verify → app.
 */
const COUNTRIES = ['Canada', 'United States', 'France', 'United Kingdom', 'Germany', 'Spain', 'Italy', 'Portugal',
  'Brazil', 'Mexico', 'Argentina', 'Morocco', 'Saudi Arabia', 'United Arab Emirates', 'Egypt', 'India',
  'China', 'Japan', 'South Korea', 'Australia', 'Netherlands', 'Sweden', 'Poland', 'Other'];
const USER_TYPES = [['solo', 'ut.solo'], ['team', 'ut.team'], ['company', 'ut.company'], ['developer', 'ut.developer'], ['designer', 'ut.designer'], ['creator', 'ut.creator'], ['other', 'ut.other']];
const GOALS = [['goal.bugs'], ['goal.regression'], ['goal.crashes'], ['goal.stability'], ['goal.evaluate']];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,32}$/;
const strongPw = (p) => p.length >= 8 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p);

export default function Auth() {
  const { api, saveSettings, setPhase, toast, settings, backendHealth, refreshUser, t } = useApp();
  const [view, setView] = useState('welcome');
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [fieldErr, setFieldErr] = useState({});

  const [f, setF] = useState({
    name: '', email: '', pass: '', pass2: '',
    username: '', dob: '', phone: '', prefLang: settings.language || 'en', country: '',
    userType: '', company: '', goal: '',
    wantPhone: false, tos: false, privacy: false, stay: true, code: ''
  });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const resetErr = () => { setErr(''); setFieldErr({}); };
  const goto = (v) => { resetErr(); setStep(0); setView(v); };

  const backendDown = () => { if (!backendHealth?.ok) { setErr(t('err.backend')); return true; } return false; };

  const fld = ({ label, k, type = 'text', placeholder, hint, autoFocus, onEnter, control }) => (
    <div className={`field ${fieldErr[k] ? 'err' : ''}`} key={k}>
      <label>{label}</label>
      {control ?? (
        <input className={`input ${fieldErr[k] ? 'err' : ''}`} type={type} placeholder={placeholder} value={f[k]} autoFocus={autoFocus}
          onChange={set(k)} onKeyDown={(e) => e.key === 'Enter' && onEnter?.()} />
      )}
      {fieldErr[k] ? <span className="field-err">⚠ {fieldErr[k]}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
  const hdr = (title, sub) => (
    <div className="auth-head">
      <img src={logo} alt="Ember" style={{ width: 52, filter: 'drop-shadow(0 0 14px rgba(255,90,20,.4))' }} />
      <div className="auth-title">{title}</div>
      {sub && <div className="auth-sub">{sub}</div>}
    </div>
  );

  const doLogin = async () => {
    resetErr();
    if (!EMAIL_RE.test(f.email)) return setFieldErr({ email: t('err.email') });
    if (!f.pass) return setFieldErr({ pass: t('err.password2') });
    if (backendDown()) return;
    setBusy(true);
    try { await afterAuth(await api.login(f.email, f.pass)); }
    catch (e) { setErr(e.data?.error ?? e.message); }
    finally { setBusy(false); }
  };

  const validateStep = () => {
    const fe = {};
    if (step === 0) {
      if (!f.name.trim()) fe.name = t('err.fullName');
      if (!EMAIL_RE.test(f.email)) fe.email = t('err.email');
      if (!strongPw(f.pass)) fe.pass = t('err.password');
      if (f.pass !== f.pass2) fe.pass2 = t('err.passwordMatch');
    } else if (step === 1) {
      if (!USERNAME_RE.test(f.username)) fe.username = t('err.username');
      if (f.dob && !/^\d{4}-\d{2}-\d{2}$/.test(f.dob)) fe.dob = 'YYYY-MM-DD';
    } else if (step === 3) {
      if (!f.tos || !f.privacy) fe.tos = t('err.tos');
    }
    setFieldErr(fe);
    return Object.keys(fe).length === 0;
  };
  const next = () => { resetErr(); if (validateStep()) setStep((s) => Math.min(s + 1, 3)); };
  const prev = () => { resetErr(); setStep((s) => Math.max(s - 1, 0)); };

  const doSignup = async () => {
    resetErr();
    if (!validateStep()) return;
    if (backendDown()) return;
    setBusy(true);
    try {
      const res = await api.signup({
        email: f.email, password: f.pass, name: f.name.trim(), username: f.username,
        dob: f.dob || undefined, phone: f.phone || undefined,
        language: f.prefLang, country: f.country || undefined,
        userType: f.userType || undefined, company: f.company || undefined, goal: f.goal || undefined,
        tosAccepted: true
      });
      await saveSettings({
        authToken: res.token, authEmail: f.email, language: f.prefLang, staySignedIn: f.stay,
        session: { name: res.user?.name ?? f.name, email: f.email, ws: res.workspace?.name ?? 'My Workspace', kind: 'account' }
      });
      if (res.verifyCode) {
        await afterAuth(res);
      } else {
        setView('verify');
      }
    } catch (e) {
      const d = e.data;
      if (d?.field) {
        const key = d.field === 'tosAccepted' ? 'tos' : d.field === 'password' ? 'pass' : d.field;
        setFieldErr({ [key]: d.error });
        if (['name', 'email', 'password'].includes(d.field)) setStep(0);
        else if (['username'].includes(d.field)) setStep(1);
      } else setErr(d?.error ?? e.message);
    } finally { setBusy(false); }
  };

  const afterAuth = async (res) => {
    await saveSettings({
      authToken: res.token, authEmail: res.user?.email ?? f.email, staySignedIn: f.stay,
      ...(res.user?.language ? { language: res.user.language } : {}),
      session: { name: res.user?.name ?? (res.user?.email ?? f.email).split('@')[0], email: res.user?.email ?? f.email, ws: res.workspace?.name ?? 'My Workspace', kind: 'account' }
    });
    await refreshUser();
    toast(t('login.title'));
    setPhase(settings.onboarded ? 'app' : 'onboarding');
  };

  const finishVerify = async () => {
    setBusy(true);
    try {
      if (f.code) { try { await api.verifyEmail(f.code); toast('✓'); } catch (e) { setBusy(false); return setFieldErr({ code: e.data?.error ?? 'Invalid code' }); } }
      await refreshUser();
      setPhase(settings.onboarded ? 'app' : 'onboarding');
    } finally { setBusy(false); }
  };

  const doForgot = async () => {
    resetErr();
    if (!EMAIL_RE.test(f.email)) return setFieldErr({ email: t('err.email') });
    if (backendDown()) return;
    setBusy(true);
    try {
      const res = await api.forgotPassword(f.email);
      setErr(res.message ?? 'If this account exists, password reset instructions have been issued.');
    } catch (e) { setErr(e.data?.error ?? e.message); }
    finally { setBusy(false); }
  };

  const langOptions = (
    <select className="input" value={f.prefLang} onChange={(e) => { setF((s) => ({ ...s, prefLang: e.target.value })); saveSettings({ language: e.target.value }); }}>
      {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
    </select>
  );

  return (
    <div className="full-center">
      <div className="auth-card anim-scale" style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', top: 18, insetInlineEnd: 18, zIndex: 5 }}><LanguageSelect variant="chip" /></div>
        {view !== 'welcome' && (
          <button className="auth-back" onClick={() => goto('welcome')}><ArrowLeft size={14} /> {t('common.back')}</button>
        )}

        {view === 'welcome' && (
          <>
            <div style={{ height: 8 }} />
            {hdr(t('welcome.title'), t('welcome.subtitle'))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <button className="auth-choice" onClick={() => goto('login')}>
                <span className="ac-ic"><LogIn size={18} /></span>
                <span style={{ flex: 1 }}><span className="ac-t">{t('welcome.login')}</span><div className="ac-d">{t('welcome.loginDesc')}</div></span>
                <ArrowRight size={16} color="var(--ink-faint)" />
              </button>
              <button className="auth-choice" onClick={() => goto('signup')}>
                <span className="ac-ic"><UserPlus size={18} /></span>
                <span style={{ flex: 1 }}><span className="ac-t">{t('welcome.signup')}</span><div className="ac-d">{t('welcome.signupDesc')}</div></span>
                <ArrowRight size={16} color="var(--ink-faint)" />
              </button>
            </div>
            <div style={{ textAlign: 'center', marginTop: 22, fontSize: 11, color: 'var(--ink-ghost)' }}>{t('welcome.locked')}</div>
          </>
        )}

        {view === 'login' && (
          <>
            {hdr(t('login.title'), t('login.subtitle'))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {fld({ label: t('f.email'), k: 'email', placeholder: 'you@studio.com', autoFocus: true, onEnter: doLogin })}
              {fld({ label: t('f.password'), k: 'pass', type: 'password', placeholder: '••••••••', onEnter: doLogin })}
              <div style={{ display: 'flex', alignItems: 'center', marginTop: -2 }}>
                <button type="button" className="check-row" aria-pressed={f.stay} style={{ fontSize: 11.5 }} onClick={() => setF((s) => ({ ...s, stay: !s.stay }))}>
                  <span className={`check-box ${f.stay ? 'on' : ''}`} style={{ width: 16, height: 16 }}>{f.stay && <Check size={11} />}</span>
                  {t('login.stay')}
                </button>
                <div style={{ flex: 1 }} />
                <button type="button" className="auth-link" style={{ fontSize: 11.5 }} onClick={() => goto('forgot')}>{t('login.forgot')}</button>
              </div>
              {err && <div className="auth-err">{err}</div>}
              <button className="btn btn-fire" style={{ width: '100%', marginTop: 2 }} disabled={busy} onClick={doLogin}>
                {busy ? t('login.loading') : t('login.submit')}
              </button>

              <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-faint)', marginTop: 4 }}>
                {t('login.noAccount')} <button type="button" className="auth-link" onClick={() => goto('signup')}>{t('login.createOne')}</button>
              </div>
            </div>
          </>
        )}

        {view === 'forgot' && (
          <>
            {hdr(t('forgot.title'), t('forgot.subtitle'))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {fld({ label: t('f.email'), k: 'email', placeholder: 'you@studio.com', autoFocus: true, onEnter: doForgot })}
              {err && <div className="auth-err">{err}</div>}
              <button className="btn btn-fire" style={{ width: '100%' }} disabled={busy} onClick={doForgot}>
                {busy ? '…' : t('forgot.submit')}
              </button>
              <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-faint)' }}>
                {t('forgot.remembered')} <button type="button" className="auth-link" onClick={() => goto('login')}>{t('login.title')}</button>
              </div>
            </div>
          </>
        )}

        {view === 'signup' && (
          <>
            {hdr(t('signup.title'))}
            <div className="steps">
              {[0, 1, 2, 3].map((i) => <div key={i} className={`step-seg ${i < step ? 'done' : i === step ? 'active' : ''}`}><i /></div>)}
            </div>
            <div className="step-lbl">{t('signup.step', { n: step + 1 })} · {t(`signup.s${step + 1}`)}</div>

            <div key={step} className="anim-up" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
              {step === 0 && <>
                {fld({ label: t('f.fullName'), k: 'name', placeholder: 'Alex Developer', autoFocus: true })}
                {fld({ label: t('f.email'), k: 'email', placeholder: 'you@studio.com' })}
                {fld({ label: t('f.password'), k: 'pass', type: 'password', placeholder: '••••••••', hint: t('f.pwHint') })}
                {fld({ label: t('f.confirmPassword'), k: 'pass2', type: 'password', placeholder: '••••••••', onEnter: next })}
              </>}

              {step === 1 && <>
                {fld({ label: t('f.username'), k: 'username', placeholder: 'alexdev', hint: t('err.username') })}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {fld({ label: t('f.dob'), k: 'dob', type: 'date', hint: t('common.optional') })}
                  {fld({ label: t('f.phone'), k: 'phone', placeholder: '+1 514 555 1234', hint: t('common.optional') })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {fld({ label: t('f.prefLang'), k: 'prefLang', control: langOptions })}
                  {fld({ label: t('f.country'), k: 'country', control: (
                    <select className="input" value={f.country} onChange={set('country')}>
                      <option value="">{t('common.selectRole')}</option>
                      {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) })}
                </div>
              </>}

              {step === 2 && <>
                {fld({ label: t('f.userType'), k: 'userType', control: (
                  <select className="input" value={f.userType} onChange={set('userType')}>
                    <option value="">{t('common.selectRole')}</option>
                    {USER_TYPES.map(([v, key]) => <option key={v} value={v}>{t(key)}</option>)}
                  </select>
                ) })}
                {fld({ label: t('f.company'), k: 'company', placeholder: 'Pixel Forge', hint: t('common.optional') })}
                {fld({ label: t('f.goal'), k: 'goal', control: (
                  <select className="input" value={f.goal} onChange={set('goal')}>
                    <option value="">{t('common.selectRole')}</option>
                    {GOALS.map(([key]) => <option key={key} value={t(key)}>{t(key)}</option>)}
                  </select>
                ) })}
              </>}

              {step === 3 && <>
                <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '13px 14px', borderRadius: 12, background: 'rgba(255,77,0,.05)', border: '1px solid rgba(255,110,50,.2)' }}>
                  <Mail size={17} color="var(--accent-soft)" style={{ flex: 'none', marginTop: 1 }} />
                  <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--ink-dim)' }}>{t('signup.emailNote', { email: f.email || '…' })}</div>
                </div>
                <button type="button" className="check-row" aria-pressed={f.wantPhone} onClick={() => setF((s) => ({ ...s, wantPhone: !s.wantPhone }))}>
                  <span className={`check-box ${f.wantPhone ? 'on' : ''}`}>{f.wantPhone && <Check size={12} />}</span>
                  <span><Phone size={12} style={{ verticalAlign: '-1px', marginInlineEnd: 4 }} />{t('signup.verifyPhone')}</span>
                </button>
                <button type="button" className="check-row" aria-pressed={f.tos} onClick={() => setF((s) => ({ ...s, tos: !s.tos }))}>
                  <span className={`check-box ${f.tos ? 'on' : ''}`} style={fieldErr.tos ? { borderColor: 'var(--err)' } : undefined}>{f.tos && <Check size={12} />}</span>
                  <span>{t('signup.acceptTos')}</span>
                </button>
                <button type="button" className="check-row" aria-pressed={f.privacy} onClick={() => setF((s) => ({ ...s, privacy: !s.privacy }))}>
                  <span className={`check-box ${f.privacy ? 'on' : ''}`} style={fieldErr.tos ? { borderColor: 'var(--err)' } : undefined}>{f.privacy && <Check size={12} />}</span>
                  <span>{t('signup.acceptPrivacy')}</span>
                </button>
                {fieldErr.tos && <span className="field-err">⚠ {fieldErr.tos}</span>}
              </>}

              {err && <div className="auth-err">{err}</div>}

              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                {step > 0 && <button className="btn btn-ghost" onClick={prev} disabled={busy}><ArrowLeft size={14} /> {t('common.back')}</button>}
                {step < 3
                  ? <button className="btn btn-fire" style={{ flex: 1 }} onClick={next}>{t('common.continue')} <ArrowRight size={14} /></button>
                  : <button className="btn btn-fire" style={{ flex: 1 }} disabled={busy} onClick={doSignup}>{busy ? t('signup.creating') : t('signup.create')}</button>}
              </div>
            </div>
          </>
        )}

        {view === 'verify' && (
          <>
            {hdr(t('verify.title'), t('verify.subtitle', { email: f.email }))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {fld({ label: t('verify.title'), k: 'code', placeholder: '123456', autoFocus: true, onEnter: finishVerify })}
              <button className="btn btn-fire" style={{ width: '100%' }} disabled={busy} onClick={finishVerify}>
                <ShieldCheck size={15} /> {busy ? '…' : t('verify.submit')}
              </button>
              <button className="btn btn-ghost btn-sm" style={{ width: '100%' }} disabled={busy}
                onClick={async () => { await refreshUser(); setPhase(settings.onboarded ? 'app' : 'onboarding'); }}>
                {t('verify.skip')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
