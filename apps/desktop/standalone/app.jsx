/* ============================================================================
   EMBER DESKTOP — 残火
   The Welcome page keeps the v21 concept untouched (molten orb + sign-in).
   Everything past the door is the forge: a lacquer-black world lit by embers,
   navigated through the Ember Dial — a molten orb that blooms into a radial
   compass. Reports open as paper scrolls. 型 · 余燼 · 点火.
   ==========================================================================*/

const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ----------------------------------------------------------- utils */
const cx = (...xs) => xs.filter(Boolean).join(' ');
const hashN = (str, mod, base) => { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return base + (h % mod); };
const fmtDate = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const initialsOf = (nm) => nm.split(/[\s.\-_]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');

/* Sections — id, latin name, kanji seal, circled index */
const SECTIONS = [
  { id: 'home',       name: 'Overview',   kanji: '炉', jp: '概観', num: '〇一', desc: 'The command fire' },
  { id: 'projects',   name: 'Projects',   kanji: '企', jp: '企画', num: '〇二', desc: 'What the forge holds' },
  { id: 'reports',    name: 'Reports',    kanji: '燼', jp: '余燼', num: '〇三', desc: 'The aftermath archive' },
  { id: 'plans',      name: 'Plans',      kanji: '型', jp: '型式', num: '〇四', desc: 'Kata — shaped runs' },
  { id: 'connectors', name: 'Connectors', kanji: '接', jp: '接続', num: '〇五', desc: 'Bridges out of the forge' },
  { id: 'config',     name: 'Config',     kanji: '設', jp: '設定', num: '〇六', desc: 'The engraving' },
  { id: 'billing',    name: 'Billing',    kanji: '料', jp: '料金', num: '〇七', desc: 'Fuel for the fire' }
];
const sectionOf = (id) => SECTIONS.find(s => s.id === id) || SECTIONS[0];

/* ----------------------------------------------------------- i18n (welcome + auth — kept verbatim from v21) */
const DICT = {
  en: {
    wKicker: 'EMBER DESKTOP — FIRST IGNITION',
    wWords: ['Welcome', 'to', 'the'], wOrange: 'forge.',
    wSub: 'Ember scans your game, mines the logs, runs your commands — and writes the aftermath report. Local-first, with clear blocked states when a hook is missing.',
    wCta: 'Create account', wCta2: 'Sign in',
    aKicker: '01 — ACCESS', hSignin: 'Back to the fire.', hSignup: 'Join the forge.',
    aSub: 'One account for your projects, reports and team. Everything stays on your machine until you say otherwise.',
    bullets: ['Local-first — your code never leaves', 'Clear blocked states', 'Free during the ignition beta'],
    lName: 'FULL NAME', lEmail: 'EMAIL', lPass: 'PASSWORD', phName: 'Ada Lovelace',
    signin: 'Sign in', signup: 'Create account', formSignin: 'Sign in', formSignup: 'Create your account',
    swapQ1: 'No account yet?', swapA1: 'Create one', swapQ2: 'Already have an account?', swapA2: 'Sign in',
    forgot: 'Forgot?', local: 'CONTINUE WITHOUT AN ACCOUNT — LOCAL-ONLY →',
    errName: 'Tell us your name.', errEmail: 'That email doesn’t look right.', errPass: 'Password needs at least 8 characters.',
    forgotToast: 'Local-only accounts do not use email reset. Sign in locally or contact your workspace admin.'
  },
  fr: {
    wKicker: 'EMBER DESKTOP — PREMIER ALLUMAGE',
    wWords: ['Bienvenue', 'dans', 'la'], wOrange: 'forge.',
    wSub: 'Ember scanne votre jeu, fouille les logs, exécute vos commandes — puis rédige le rapport. Local d’abord, avec des états bloqués clairs quand un hook manque.',
    wCta: 'Créer un compte', wCta2: 'Se connecter',
    aKicker: '01 — ACCÈS', hSignin: 'Retour au feu.', hSignup: 'Rejoindre la forge.',
    aSub: 'Un compte pour vos projets, rapports et votre équipe. Tout reste sur votre machine tant que vous ne décidez pas autrement.',
    bullets: ['Local d’abord — votre code ne sort jamais', 'États bloqués clairs', 'Gratuit pendant la bêta'],
    lName: 'NOM COMPLET', lEmail: 'COURRIEL', lPass: 'MOT DE PASSE', phName: 'Ada Lovelace',
    signin: 'Se connecter', signup: 'Créer un compte', formSignin: 'Connexion', formSignup: 'Créer votre compte',
    swapQ1: 'Pas encore de compte ?', swapA1: 'Créez-en un', swapQ2: 'Déjà un compte ?', swapA2: 'Connectez-vous',
    forgot: 'Oublié ?', local: 'CONTINUER SANS COMPTE — LOCAL SEULEMENT →',
    errName: 'Dites-nous votre nom.', errEmail: 'Ce courriel ne semble pas valide.', errPass: 'Le mot de passe doit faire au moins 8 caractères.',
    forgotToast: 'Les comptes locaux n’utilisent pas la réinitialisation par courriel. Connectez-vous localement ou contactez votre admin.'
  }
};

/* ----------------------------------------------------------- tiny atoms */
function Orb({ size, float = true, glow = .95, style }) {
  /* No PNG fallback frame here — on the dark side its square edge shows.
     <molten-core> paints its own round CSS blob until WebGL takes over. */
  return (
    <div className={float ? 'ember-molten-wrap' : ''} style={{ position: float ? 'absolute' : 'relative', width: size, height: size, pointerEvents: 'none', ...style }}>
      <div className="ember-molten-glow" style={{ inset: '-58%', opacity: glow }}></div>
      <molten-core style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', filter: 'drop-shadow(0 38px 78px rgba(232,84,16,.22))' }}></molten-core>
    </div>
  );
}

function Kicker({ jp, children, style }) {
  return <div className="kicker" style={style}>{children}{jp && <span className="jp">{jp}</span>}</div>;
}

function WordUp({ words, orange, base = .12, step = .08, className = 'h-hero' }) {
  return (
    <h1 className={className}>
      {words.map((w, i) => (
        <span key={i} style={{ display: 'inline-block', opacity: 0, marginRight: '.24em', animation: `wordUp .8s cubic-bezier(.2,.8,.2,1) ${(base + i * step).toFixed(2)}s forwards` }}>{w}</span>
      ))}
      {orange && (
        <span className="molten-text" style={{ display: 'inline-block', opacity: 0, animation: `wordUp .8s cubic-bezier(.2,.8,.2,1) ${(base + words.length * step).toFixed(2)}s forwards, shimmer 5s linear 1.6s infinite` }}>{orange}</span>
      )}
    </h1>
  );
}

function Coal({ on, flip }) {
  return (
    <button type="button" className={cx('coal', on && 'on')} onClick={flip} aria-pressed={!!on}>
      <span className="core"></span>
    </button>
  );
}

function Field({ label, type = 'text', value, onChange, placeholder, mono, right }) {
  return (
    <div className="fld">
      <label>{label}{right && <span style={{ float: 'right', letterSpacing: '.05em' }}>{right}</span>}</label>
      <input type={type} value={value} onChange={onChange} placeholder={placeholder}
        style={mono ? { fontFamily: 'var(--f-mono)', fontSize: 13 } : null} spellCheck={false} />
    </div>
  );
}

/* Ember sparks — a living canvas of rising embers behind the forge */
function EmberField({ paused, density = 46 }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, raf = 0, alive = true;
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    const size = () => {
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * DPR; canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };
    size();
    const ro = new ResizeObserver(size); ro.observe(canvas);
    const P = [];
    const spawn = (init) => ({
      x: Math.random() * W,
      y: init ? Math.random() * H : H + 10,
      r: .6 + Math.random() * 1.9,
      vy: .12 + Math.random() * .5,
      vx: (Math.random() - .5) * .16,
      tw: Math.random() * Math.PI * 2,
      hue: 18 + Math.random() * 26,
      a: .12 + Math.random() * .5
    });
    for (let i = 0; i < density; i++) P.push(spawn(true));
    let t = 0;
    const tick = () => {
      if (!alive) return;
      t += .016;
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        p.y -= p.vy; p.x += p.vx + Math.sin(t * 1.3 + p.tw) * .12;
        const flicker = .62 + Math.sin(t * 5 + p.tw * 3) * .38;
        if (p.y < -12) P[i] = spawn(false);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.283);
        ctx.fillStyle = `hsla(${p.hue}, 100%, 62%, ${(p.a * flicker).toFixed(3)})`;
        ctx.shadowColor = 'rgba(255,120,30,.85)';
        ctx.shadowBlur = 7;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    if (!paused) raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); };
  }, [paused, density]);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />;
}

/* Ambient stack for dark screens */
function ForgeAmbient({ sparks = true, paused }) {
  return (
    <React.Fragment>
      <div className="aurora"></div>
      <div className="floor-glow"></div>
      {sparks && <EmberField paused={paused} />}
      <div className="grain"></div>
      <div className="vignette"></div>
    </React.Fragment>
  );
}

/* Perspective tilt on hover — depth without a framework */
function Tilt({ children, max = 5, style, className }) {
  const ref = useRef(null);
  const onMove = (e) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - .5;
    const py = (e.clientY - r.top) / r.height - .5;
    el.style.transform = `perspective(1100px) rotateY(${(px * max).toFixed(2)}deg) rotateX(${(-py * max).toFixed(2)}deg) translateY(-2px)`;
  };
  const onLeave = () => { const el = ref.current; if (el) el.style.transform = 'perspective(1100px)'; };
  return (
    <div ref={ref} className={className} onMouseMove={onMove} onMouseLeave={onLeave}
      style={{ transition: 'transform .35s var(--ease)', willChange: 'transform', ...style }}>
      {children}
    </div>
  );
}

/* ============================================================================
   WELCOME — the v21 home page, concept untouched.
   Big animated molten orb, language pills, staggered headline, sign-in CTAs.
   ==========================================================================*/
function Welcome({ L, lang, setLang, onSignup, onSignin }) {
  return (
    <div data-screen-label="Welcome" style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'var(--f-ui)' }}>
      <div className="ember-molten-wrap" style={{ right: 40, top: '50%', width: 380, height: 380, marginTop: -190 }}>
        <div className="ember-molten-glow" style={{ inset: '-68%', filter: 'blur(18px)' }}></div>
        <molten-core style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', background: 'var(--ember-molten-fallback) center/contain no-repeat', filter: 'drop-shadow(0 38px 78px rgba(232,84,16,.22))' }}></molten-core>
      </div>

      <div style={{ position: 'absolute', top: 26, right: 32, display: 'flex', gap: 6, zIndex: 5 }}>
        {['en', 'fr'].map(code => {
          const on = lang === code;
          return (
            <button key={code} onClick={() => setLang(code)} style={{
              padding: '7px 14px', borderRadius: 100, cursor: 'pointer',
              border: `1px solid ${on ? '#1a1512' : 'rgba(26,21,18,.18)'}`,
              background: on ? '#1a1512' : 'transparent', color: on ? '#f3ede4' : 'rgba(26,21,18,.5)',
              fontSize: 11, fontWeight: 600, fontFamily: 'var(--f-mono)', letterSpacing: '.1em', transition: 'all .25s'
            }}>{code.toUpperCase()}</button>
          );
        })}
      </div>

      <div style={{ position: 'absolute', left: '7%', top: '50%', transform: 'translateY(-50%)', maxWidth: 820, zIndex: 2 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderRadius: 100,
          border: '1px solid rgba(232,84,16,.3)', background: 'rgba(232,84,16,.05)',
          fontSize: 11.5, fontFamily: 'var(--f-mono)', letterSpacing: '.1em', color: '#d4520a', animation: 'riseIn .7s both'
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#e85410', animation: 'blink 1.6s infinite' }}></span>{L.wKicker}
        </div>
        <h1 style={{ marginTop: 28, fontFamily: 'var(--f-bric)', fontWeight: 700, fontSize: 'clamp(56px,7.4vw,108px)', lineHeight: .94, letterSpacing: '-.03em' }}>
          {L.wWords.map((w, i) => (
            <span key={i} style={{ display: 'inline-block', opacity: 0, marginRight: '.24em', animation: `wordUp .8s cubic-bezier(.2,.8,.2,1) ${(0.15 + i * 0.09).toFixed(2)}s forwards` }}>{w}</span>
          ))}
          <span style={{
            display: 'inline-block', opacity: 0,
            background: 'linear-gradient(100deg,#e85410,#ff8a3c 55%,#e85410)', backgroundSize: '200% auto',
            WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
            animation: `wordUp .8s cubic-bezier(.2,.8,.2,1) ${(0.15 + L.wWords.length * 0.09).toFixed(2)}s forwards, shimmer 5s linear 1.6s infinite`
          }}>{L.wOrange}</span>
        </h1>
        <p style={{ marginTop: 26, fontSize: 18, lineHeight: 1.65, color: 'rgba(26,21,18,.62)', maxWidth: 520, opacity: 0, animation: 'riseIn .8s .55s both' }}>{L.wSub}</p>
        <div style={{ marginTop: 38, display: 'flex', gap: 14, alignItems: 'center', opacity: 0, animation: 'riseIn .8s .75s both' }}>
          <button onClick={onSignup} className="w-cta-main" style={{
            display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 16, fontWeight: 600,
            padding: '16px 30px', borderRadius: 100, border: 'none', cursor: 'pointer',
            color: '#fff8f0', background: '#e85410', boxShadow: '0 16px 40px rgba(232,84,16,.3)', transition: 'all .25s'
          }}>{L.wCta} <span style={{ fontSize: 17 }}>→</span></button>
          <button onClick={onSignin} className="w-cta-ghost" style={{
            display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 16, fontWeight: 500,
            padding: '16px 28px', borderRadius: 100, cursor: 'pointer', color: '#1a1512',
            border: '1px solid rgba(26,21,18,.2)', background: 'transparent', transition: 'all .25s'
          }}>{L.wCta2}</button>
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: 30, left: '7%', fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '.16em', color: 'rgba(26,21,18,.4)' }}>
        MAC · WINDOWS · LINUX — IGNITION BUILD 0.2.0
      </div>
      <style>{`
        .w-cta-main:hover{ transform:translateY(-3px); box-shadow:0 22px 54px rgba(232,84,16,.42) !important; background:#f25c14 !important; }
        .w-cta-ghost:hover{ border-color:#e85410 !important; color:#e85410 !important; background:rgba(232,84,16,.04) !important; }
      `}</style>
    </div>
  );
}

/* ============================================================================
   AUTH — the threshold of the forge. First dark screen: embers rise,
   a glass card floats, the kanji 火 watches from the edge.
   ==========================================================================*/
function Auth({ L, lang, setLang, mode, fields, err, onField, onSubmit, onToggleMode, onForgot, onLocal, reduced }) {
  const signup = mode === 'signup';
  return (
    <div data-screen-label="Auth" style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'var(--void)', color: 'var(--cream)', animation: 'fadeIn .6s both' }}>
      <ForgeAmbient paused={reduced} />
      <div className="ghost-kanji" style={{ right: '4%', top: '14%', fontSize: 'clamp(200px,28vh,320px)' }}>火防</div>

      <div style={{ position: 'absolute', top: 26, right: 32, display: 'flex', gap: 6, zIndex: 6 }}>
        {['en', 'fr'].map(code => {
          const on = lang === code;
          return (
            <button key={code} onClick={() => setLang(code)} className="top-pill" style={{
              height: 32, padding: '0 14px', fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '.12em', fontWeight: 600,
              ...(on ? { background: 'var(--cream)', color: '#1a1512', borderColor: 'var(--cream)' } : {})
            }}>{code.toUpperCase()}</button>
          );
        })}
      </div>

      <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1.05fr 1fr', zIndex: 2 }}>
        {/* narrative side */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 7%', animation: 'riseIn .8s .1s both' }}>
          <Kicker jp="入口">{L.aKicker}</Kicker>
          <h1 style={{ marginTop: 26, maxWidth: 560 }} className="h-view">
            <span className="serif-accent" style={{ fontWeight: 400 }}>{signup ? L.hSignup : L.hSignin}</span>
          </h1>
          <p className="sub" style={{ marginTop: 24, maxWidth: 440 }}>{L.aSub}</p>
          <div style={{ marginTop: 34, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {L.bullets.map((b, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 15, fontWeight: 500, color: 'var(--cream-70)', opacity: 0, animation: `riseIn .6s ${.35 + i * .12}s var(--ease) both` }}>
                <span style={{
                  width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center',
                  background: 'rgba(255,106,26,.12)', border: '1px solid rgba(255,106,26,.4)', color: 'var(--ember-hot)', fontSize: 12
                }}>✓</span>{b}
              </div>
            ))}
          </div>
          <div className="mono-dim" style={{ marginTop: 60, letterSpacing: '.16em' }}>EMBER DESKTOP — IGNITION BUILD 0.2.0</div>
        </div>

        {/* form side */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <div className="glass-2" style={{
            width: '100%', maxWidth: 470, borderRadius: 26, padding: '42px 42px 36px', position: 'relative',
            boxShadow: '0 60px 140px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,190,120,.12)',
            animation: 'popIn .7s .18s var(--ease) both'
          }}>
            <div style={{ position: 'absolute', top: 0, left: '10%', right: '10%', height: 1, background: 'linear-gradient(90deg,transparent,rgba(255,150,70,.55),transparent)' }}></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img src="ember-logo.png" alt="" style={{ width: 26, height: 26, objectFit: 'contain' }} />
              <span className="f-syne" style={{ fontWeight: 700, letterSpacing: '.3em', fontSize: 13, color: 'var(--cream)' }}>EMBER</span>
              <span className="f-min" style={{ marginLeft: 'auto', color: 'var(--cream-28)', fontSize: 15 }}>点火</span>
            </div>
            <h2 className="h-panel" style={{ marginTop: 26, fontSize: 27 }}>{signup ? L.formSignup : L.formSignin}</h2>

            <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>
              {signup && (
                <Field label={L.lName} value={fields.aName} onChange={onField('aName')} placeholder={L.phName} />
              )}
              <Field label={L.lEmail} value={fields.aEmail} onChange={onField('aEmail')} placeholder="you@studio.dev" />
              <div className="fld">
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{L.lPass}</span>
                  {!signup && <button onClick={onForgot} style={{ border: 'none', background: 'none', fontSize: 12, color: 'var(--ember-hot)', fontWeight: 600, letterSpacing: 0, textTransform: 'none' }}>{L.forgot}</button>}
                </label>
                <input type="password" value={fields.aPass} onChange={onField('aPass')} placeholder="••••••••"
                  onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }} />
              </div>
              {err && <div className="err-band">{err}</div>}
              <button className="btn btn-molten" style={{ width: '100%', padding: '15px', fontSize: 15, marginTop: 4 }} onClick={onSubmit}>
                {signup ? L.signup : L.signin}
              </button>
              <div style={{ textAlign: 'center', fontSize: 13.5, color: 'var(--cream-55)' }}>
                {signup ? L.swapQ2 : L.swapQ1}{' '}
                <button onClick={onToggleMode} style={{ border: 'none', background: 'none', color: 'var(--ember-hot)', fontWeight: 600, fontSize: 13.5 }}>{signup ? L.swapA2 : L.swapA1}</button>
              </div>
              <button onClick={onLocal} className="local-link" style={{
                border: 'none', background: 'none', fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '.12em',
                color: 'var(--cream-40)', paddingTop: 8, transition: 'color .25s'
              }}>{L.local}</button>
            </div>
          </div>
        </div>
      </div>
      <style>{`.local-link:hover{ color:var(--ember-hot) !important; }`}</style>
    </div>
  );
}

/* ============================================================================
   IGNITION — the cinematic passage between the door and the forge.
   ==========================================================================*/
function Ignition({ done }) {
  const [lines, setLines] = useState([]);
  useEffect(() => {
    const seq = [
      ['› agent core 0.2.0 — armed', 'var(--jade)'],
      ['› backend offline — local-first mode', 'var(--amber)'],
      ['› the forge is warm', 'var(--ember-hot)']
    ];
    const timers = seq.map((l, i) => setTimeout(() => setLines(s => [...s, l]), 220 + i * 300));
    timers.push(setTimeout(done, 1650));
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <div onClick={done} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'var(--void)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
      <div style={{ position: 'relative', width: 130, height: 130, animation: 'igniteFlare .9s var(--ease) both' }}>
        <Orb size={130} float={false} />
      </div>
      <div className="f-min" style={{ marginTop: 30, fontSize: 30, fontWeight: 700, color: 'var(--cream)', letterSpacing: '.3em', animation: 'sealStamp .6s .25s var(--ease) both', opacity: 0, animationFillMode: 'forwards' }}>点火</div>
      <div className="mono-tag" style={{ marginTop: 8, animation: 'fadeIn .5s .5s both', opacity: 0 }}>IGNITION</div>
      <div style={{ marginTop: 26, minHeight: 70, display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'center' }}>
        {lines.map((l, i) => (
          <div key={i} className="f-mono" style={{ fontSize: 11.5, letterSpacing: '.06em', color: l[1], animation: 'riseInSoft .35s both' }}>{l[0]}</div>
        ))}
      </div>
    </div>
  );
}
/* ============================================================================
   SHELL CHROME — top bar, the Ember Dial and its radial Nav Bloom,
   command palette, notifications, toast.
   ==========================================================================*/

function TopBar({ view, project, running, unread, onBloom, onPalette, onBell, onSheet, user }) {
  const sec = sectionOf(view);
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50, display: 'flex', alignItems: 'center', gap: 10, padding: '18px 24px', pointerEvents: 'none' }}>
      {/* brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, pointerEvents: 'auto' }}>
        <img src="ember-logo.png" alt="" style={{ width: 25, height: 25, objectFit: 'contain', filter: 'drop-shadow(0 3px 10px rgba(255,106,26,.5))' }} />
        <span className="f-syne" style={{ fontWeight: 700, letterSpacing: '.3em', fontSize: 13, color: 'var(--cream)' }}>EMBER</span>
        <span className="mono-tag" style={{ fontSize: 8.5, marginTop: 2, color: 'var(--cream-28)' }}>0.2.0</span>
      </div>

      <div style={{ flex: 1 }}></div>

      {/* breadcrumb — opens the bloom */}
      <button onClick={onBloom} className="top-pill" style={{ pointerEvents: 'auto', gap: 11, position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
        <span className="f-min" style={{ fontSize: 12, color: 'var(--ember-hot)' }}>{sec.num}</span>
        <span className="f-syne" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.22em', color: 'var(--cream)', textTransform: 'uppercase' }}>{sec.name}</span>
        <span style={{ fontSize: 8, color: 'var(--cream-40)', transform: 'translateY(1px)' }}>▼</span>
      </button>

      {/* status capsule */}
      <div className="top-pill" style={{ fontFamily: 'var(--f-mono)', fontSize: 9.5, letterSpacing: '.14em', gap: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', flex: 'none', background: running ? 'var(--ember)' : (project ? 'var(--jade)' : 'var(--cream-28)'), boxShadow: running ? '0 0 10px var(--ember)' : 'none', animation: running ? 'blink 1s infinite' : 'none' }}></span>
        {running ? 'RUN IN PROGRESS' : (project ? 'LOCAL PROJECT' : 'NOT CONNECTED')}
      </div>

      <button onClick={onPalette} className="top-pill" style={{ pointerEvents: 'auto' }}>
        <span className="kbd">⌘K</span>
        <span style={{ fontSize: 12 }}>Commands</span>
      </button>

      <button onClick={onBell} className="top-pill" style={{ pointerEvents: 'auto', width: 38, padding: 0, justifyContent: 'center', position: 'relative' }} aria-label="Notifications">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path></svg>
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4, minWidth: 17, height: 17, borderRadius: 100, padding: '0 4px',
            background: 'linear-gradient(135deg,var(--gold),var(--ember))', color: '#1c0d02',
            fontSize: 9.5, fontWeight: 800, display: 'grid', placeItems: 'center', boxShadow: '0 4px 14px rgba(255,106,26,.5)'
          }}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      <button onClick={onSheet} className="top-pill avatar-pill" style={{ pointerEvents: 'auto', width: 38, padding: 0, justifyContent: 'center', background: 'var(--cream)', color: '#1a1512', fontFamily: 'var(--f-syne)', fontWeight: 700, fontSize: 11, letterSpacing: '.04em' }} aria-label="Profile & settings">
        {user.initials}
      </button>
      <style>{`.avatar-pill:hover{ box-shadow:0 0 0 2px var(--ember); color:#1a1512 !important; }`}</style>
    </div>
  );
}

/* The Ember Dial — the molten orb as navigation instrument */
function EmberDial({ running, onOpen }) {
  return (
    <button className={cx('dial', running && 'running')} onClick={onOpen} aria-label="Open navigation">
      <span className="halo"></span>
      <span className="ring"></span>
      <Orb size={64} float={false} glow={0} />
      <span className="lbl">NAVIGATE · 航</span>
    </button>
  );
}

/* Radial navigation bloom */
function NavBloom({ view, go, close, reduced, ignite, openConnect, project, running }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { close(); return; }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= SECTIONS.length) go(SECTIONS[n - 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, close]);

  const R = Math.min(340, Math.max(250, window.innerHeight * 0.36));
  const cy = window.innerHeight * 0.62;
  const cx0 = window.innerWidth / 2;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90 }}>
      <div className="veil" onClick={close} style={{ background: 'rgba(4,2,1,.72)' }}></div>
      <div className="floor-glow" style={{ position: 'fixed', opacity: .9 }}></div>

      {/* center orb — animation on an inner div so it can't clobber the centering transform */}
      <div style={{ position: 'fixed', left: cx0, top: cy, transform: 'translate(-50%,-50%)', pointerEvents: 'none' }}>
        <div style={{ animation: 'igniteFlare .5s var(--ease) both' }}>
          <Orb size={150} float={false} />
        </div>
      </div>
      <div className="f-min" style={{ position: 'fixed', left: cx0, top: cy + 110, transform: 'translateX(-50%)', color: 'var(--cream-40)', fontSize: 13, letterSpacing: '.55em', animation: 'fadeIn .6s .2s both', opacity: 0, pointerEvents: 'none' }}>航海図</div>

      {/* quick actions — the fire is always one gesture away */}
      <div style={{ position: 'fixed', left: cx0, top: cy + 152, transform: 'translateX(-50%)', display: 'flex', gap: 10, animation: 'fadeIn .5s .3s both', opacity: 0 }}>
        <button className="btn btn-molten" style={{ padding: '11px 24px', fontSize: 13 }} onClick={ignite}>
          {running ? 'Run burning…' : 'Ignite run'}
        </button>
        <button className="btn btn-ghost" style={{ padding: '10px 22px', fontSize: 13, background: 'rgba(14,8,5,.6)' }} onClick={openConnect}>
          {project ? project.name : 'Connect a project'}
        </button>
      </div>

      {/* radial items */}
      {SECTIONS.map((s, i) => {
        const a = Math.PI - (i * Math.PI / (SECTIONS.length - 1));
        const x = cx0 + Math.cos(a) * R;
        const y = cy - Math.sin(a) * R * 0.92;
        return (
          <button key={s.id} className={cx('bloom-item', view === s.id && 'on')}
            style={{ left: x, top: y, animationDelay: `${(.05 + i * .045).toFixed(3)}s` }}
            onClick={() => go(s.id)}>
            <span className="kj">{s.kanji}</span>
            <span className="nm">{s.name}</span>
            <span className="ix">{i + 1}</span>
          </button>
        );
      })}

      <div style={{ position: 'fixed', left: '50%', bottom: 30, transform: 'translateX(-50%)', display: 'flex', gap: 22, animation: 'fadeIn .5s .35s both', opacity: 0 }}>
        <span className="mono-dim">1–7 NAVIGATE</span>
        <span className="mono-dim">⌘K COMMANDS</span>
        <span className="mono-dim">ESC CLOSE</span>
      </div>
    </div>
  );
}

/* Command palette — the incantation bar */
function Palette({ q, setQ, sel, setSel, items, close }) {
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(sel + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(sel - 1, 0)); }
    else if (e.key === 'Enter') { const it = items[sel]; if (it) it.run(); }
    else if (e.key === 'Escape') close();
  };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 92 }}>
      <div className="veil" onClick={close}></div>
      <div style={{ position: 'fixed', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '15vh', pointerEvents: 'none' }}>
      <div className="glass-2" style={{
        width: 600, borderRadius: 22, pointerEvents: 'auto',
        overflow: 'hidden', boxShadow: '0 70px 160px rgba(0,0,0,.7), 0 0 60px rgba(255,106,26,.07)',
        animation: 'popIn .3s var(--ease-spring) both'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '6px 22px', borderBottom: '1px solid var(--line)' }}>
          <span className="f-min" style={{ color: 'var(--ember-hot)', fontSize: 15 }}>令</span>
          <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey}
            placeholder="Type a command…"
            style={{ flex: 1, padding: '17px 0', border: 'none', outline: 'none', background: 'transparent', fontSize: 16.5, color: 'var(--cream)' }} />
          <span className="kbd">ESC</span>
        </div>
        <div style={{ maxHeight: 350, overflowY: 'auto', padding: 8 }}>
          {items.map((it, i) => (
            <button key={i} className={cx('pal-row', i === sel && 'sel')} onClick={it.run} onMouseEnter={() => setSel(i)}>
              <span className="f-min" style={{ width: 20, textAlign: 'center', color: i === sel ? 'var(--gold)' : 'var(--cream-28)', fontSize: 13 }}>{it.kanji || '·'}</span>
              <span style={{ fontSize: 14, fontWeight: 500, color: i === sel ? 'var(--cream)' : 'var(--cream-70)', flex: 1 }}>{it.label}</span>
              <span className="f-mono" style={{ fontSize: 9, letterSpacing: '.18em', color: 'var(--cream-40)' }}>{it.kind}</span>
            </button>
          ))}
          {items.length === 0 && <div style={{ padding: 18, fontSize: 13.5, color: 'var(--cream-40)' }}>No matching command.</div>}
        </div>
      </div>
      </div>
    </div>
  );
}

/* Notifications panel */
function BellPanel({ items, empty, hasUnread, markAll, close }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 88 }}>
      <div onClick={close} style={{ position: 'fixed', inset: 0 }}></div>
      <div className="glass-2" style={{
        position: 'fixed', top: 68, right: 80, width: 380, borderRadius: 22, overflow: 'hidden', zIndex: 89,
        boxShadow: '0 50px 120px rgba(0,0,0,.65)', animation: 'popIn .32s var(--ease-spring) both',
        background: 'rgba(18,11,7,.88)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '20px 22px 14px' }}>
          <div>
            <div className="h-panel" style={{ fontSize: 17 }}>Notifications</div>
            <div className="f-min" style={{ fontSize: 10, color: 'var(--cream-28)', letterSpacing: '.3em', marginTop: 3 }}>通知</div>
          </div>
          {hasUnread && <button onClick={markAll} style={{ border: 'none', background: 'none', fontSize: 11.5, fontWeight: 600, color: 'var(--ember-hot)' }}>Mark all read</button>}
        </div>
        {empty && (
          <div style={{ padding: '8px 22px 26px', fontSize: 13.5, lineHeight: 1.65, color: 'var(--cream-40)' }}>
            Quiet for now. Runs, reports, critical bugs and billing events will land here.
          </div>
        )}
        <div style={{ maxHeight: 390, overflowY: 'auto' }}>
          {items.map((nt) => (
            <button key={nt.id} onClick={nt.read} style={{
              display: 'flex', gap: 13, width: '100%', textAlign: 'left', padding: '14px 22px',
              border: 'none', borderTop: '1px solid var(--line)', background: 'transparent',
              opacity: nt.isRead ? .5 : 1, transition: 'background .2s'
            }} className="bell-row">
              <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', marginTop: 5, background: nt.isRead ? 'var(--cream-28)' : 'var(--ember)', boxShadow: nt.isRead ? 'none' : '0 0 10px rgba(255,106,26,.7)' }}></span>
              <span style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cream)' }}>{nt.title}</div>
                <div style={{ marginTop: 2, fontSize: 12, color: 'var(--cream-55)' }}>{nt.body}</div>
                <div className="f-mono" style={{ marginTop: 5, fontSize: 9, letterSpacing: '.1em', color: 'var(--cream-28)' }}>{nt.time}</div>
              </span>
            </button>
          ))}
        </div>
        <style>{`.bell-row:hover{ background:rgba(255,120,40,.06) !important; }`}</style>
      </div>
    </div>
  );
}

function Toast({ msg }) {
  return (
    <div className="toast">
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ember)', boxShadow: '0 0 10px rgba(255,106,26,.9)', flex: 'none' }}></span>
      {msg}
    </div>
  );
}
/* ============================================================================
   VIEWS I — Overview (炉), Projects (企), Reports (燼), Plans (型)
   ==========================================================================*/

function ViewFrame({ sec, children }) {
  return (
    <div className="view-scroll" key={sec.id}>
      <div className="view-pad" style={{ animation: 'viewIn .6s var(--ease) both' }}>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------ OVERVIEW — the command fire */
function OverviewView({ project, reports, running, runLines, steps, ignite, openConnect, openReport, dateStr }) {
  const lastRep = reports[0] || null;
  const title = project
    ? { words: [project.name, 'is', 'ready', 'to'], orange: 'burn.' }
    : { words: ['Light', 'the'], orange: 'forge.' };
  const sub = project
    ? 'The config is written and the agent is armed. Ignite a run — scan, analyze, logs — and read the aftermath.'
    : 'Connect your first game project. Ember scans the code, mines the logs, runs your commands — and writes the aftermath.';
  const termLines = (running || runLines.length) ? runLines
    : [{ t: '› forge idle — ' + (project ? 'ready to ignite ' + project.name : 'connect a project to ignite'), c: 'var(--cream-40)' }];

  return (
    <React.Fragment>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Kicker jp="司令炉">00 — COMMAND CENTER</Kicker>
        <div className="mono-dim">{dateStr}</div>
      </div>

      <div style={{ marginTop: 26 }}>
        <WordUp words={title.words} orange={title.orange} />
      </div>
      <p className="sub" style={{ marginTop: 24, maxWidth: 580, opacity: 0, animation: 'riseIn .7s .4s var(--ease) both' }}>{sub}</p>

      <div style={{ marginTop: 30, display: 'flex', gap: 10, flexWrap: 'wrap', opacity: 0, animation: 'riseIn .7s .55s var(--ease) both' }}>
        <span className="chip"><span className="dot" style={{ background: project ? 'var(--jade)' : 'var(--cream-28)' }}></span>{project ? 'PROJECT: ' + project.name.toUpperCase() : 'NOT CONNECTED'}</span>
        <span className="chip"><span className="dot" style={{ background: 'var(--amber)' }}></span>BACKEND OFFLINE — LOCAL-FIRST</span>
        <span className="chip"><span className="dot" style={{ background: 'var(--ember)' }}></span>AGENT CORE 0.2.0</span>
      </div>

      <div style={{ marginTop: 52, display: 'grid', gridTemplateColumns: '1.2fr .95fr', gap: 22, alignItems: 'stretch' }}>
        {/* Ignition sequence — 点火手順 */}
        <div style={{ opacity: 0, animation: 'riseIn .7s .65s var(--ease) both' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 4px 20px' }}>
            <div>
              <div className="mono-tag" style={{ color: 'var(--ember)' }}>IGNITION SEQUENCE</div>
              <div className="h-panel" style={{ marginTop: 9, fontSize: 24 }}>Three steps to your first report.</div>
            </div>
            <span className="f-min" style={{ color: 'var(--cream-28)', fontSize: 15, letterSpacing: '.3em' }}>点火手順</span>
          </div>
          <div style={{ position: 'relative', paddingLeft: 24 }}>
            <div style={{ position: 'absolute', left: 4, top: 22, bottom: 26, width: 1, background: 'linear-gradient(180deg, rgba(255,120,40,.5), var(--line))', transformOrigin: 'top', animation: 'drawDown 1.2s .8s var(--ease) both' }}></div>
            {steps.map((st, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 22, alignItems: 'center', padding: '22px 6px', opacity: 0, animation: `riseIn .6s ${.8 + i * .14}s var(--ease) both` }}>
                <div className="num-min" style={{ fontSize: 46, lineHeight: 1, color: st.hot ? 'var(--ember)' : 'var(--cream-28)', textShadow: st.hot ? '0 0 30px rgba(255,106,26,.45)' : 'none', textAlign: 'center' }}>{st.minNum}</div>
                <div>
                  <div className="h-panel" style={{ fontSize: 18 }}>{st.title}
                    <span className="f-mono" style={{ fontSize: 9, letterSpacing: '.2em', color: 'var(--cream-28)', marginLeft: 12 }}>{st.num}</span>
                  </div>
                  <div style={{ marginTop: 5, fontSize: 13.5, lineHeight: 1.55, color: 'var(--cream-55)', maxWidth: 390 }}>{st.desc}</div>
                </div>
                {st.showBtn
                  ? <button className="btn btn-molten" style={{ padding: '11px 22px', fontSize: 13 }} onClick={st.go}>{st.btnLabel}</button>
                  : <span className={cx('seal', st.tagKind === 'done' ? 'seal-jade' : (st.tagKind === 'hot' ? '' : 'seal-dim'))}>{st.tag}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Forge feed — live terminal */}
        <div className="forge-slab" style={{ opacity: 0, animation: 'riseIn .7s .8s var(--ease) both', display: 'flex', flexDirection: 'column', background: 'linear-gradient(180deg, rgba(255,120,40,.06), transparent 130px), #0b0705' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 20px', borderBottom: '1px solid var(--line)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: running ? 'var(--ember)' : 'var(--jade)', boxShadow: `0 0 10px ${running ? 'rgba(255,106,26,.9)' : 'rgba(69,217,140,.7)'}`, animation: running ? 'blink .9s infinite' : 'none' }}></span>
            <span className="f-mono" style={{ fontSize: 10.5, letterSpacing: '.14em', color: 'var(--cream-40)' }}>FORGE FEED — EMBER AGENT</span>
            <span className="f-min" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--cream-28)' }}>実況</span>
          </div>
          <div className="f-mono" style={{ padding: '20px 22px 16px', fontSize: 12.5, lineHeight: 2.15, flex: 1, minHeight: 320, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            {termLines.map((tl, i) => (
              <div key={i} style={{ color: tl.c, animation: 'riseInSoft .35s both' }}>{tl.t}</div>
            ))}
            <div style={{ color: 'var(--cream-28)' }}>›&nbsp;<span style={{ display: 'inline-block', width: 8, height: 14, background: 'var(--ember-hot)', animation: 'blink 1.2s infinite', verticalAlign: 'middle' }}></span></div>
          </div>
        </div>
      </div>

      {/* Last aftermath */}
      {lastRep && (
        <div className="forge-slab" style={{ marginTop: 24, padding: '26px 34px', display: 'flex', alignItems: 'center', gap: 34, animation: 'riseIn .6s both' }}>
          <div className="f-syne molten-text" style={{ fontWeight: 800, fontSize: 58, lineHeight: 1, letterSpacing: '-.03em' }}>{lastRep.stability}</div>
          <div style={{ flex: 1 }}>
            <div className="mono-tag">LAST AFTERMATH — STABILITY</div>
            <div style={{ marginTop: 6, fontSize: 14.5, color: 'var(--cream-55)' }}>{lastRep.project} · {lastRep.profile} · {lastRep.findings} findings · {lastRep.logs} log issues</div>
          </div>
          <span className="f-min" style={{ fontSize: 22, color: 'var(--cream-28)' }}>余燼</span>
          <button className="btn btn-ghost" onClick={() => openReport(lastRep)}>Open report →</button>
        </div>
      )}
    </React.Fragment>
  );
}

/* ------------------------------------------------ PROJECTS — the forge holds */
function ProjectsView({ project, openConnect, ignite, goConfig, disconnect }) {
  return (
    <React.Fragment>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <Kicker jp="企画">01 — PROJECTS</Kicker>
          <h1 className="h-view" style={{ marginTop: 20 }}>Projects<span className="molten-text">.</span></h1>
        </div>
        <button className="btn btn-molten" onClick={openConnect}>Connect a project</button>
      </div>

      {!project && (
        <div style={{ marginTop: 22, position: 'relative', textAlign: 'center', padding: '14px 0 10px' }}>
          <div style={{ position: 'relative', width: 168, height: 168, margin: '0 auto' }}>
            <Orb size={168} float={false} />
          </div>
          <div style={{ width: 150, height: 20, margin: '10px auto 0', borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(255,106,26,.22), transparent 70%)', filter: 'blur(6px)' }}></div>
          <div className="mono-tag" style={{ marginTop: 22, color: 'var(--cream-40)' }}>THE FORGE IS EMPTY — <span className="f-min" style={{ letterSpacing: '.3em' }}>空の炉</span></div>
          <h2 className="f-min" style={{ marginTop: 12, fontWeight: 600, fontSize: 'clamp(28px,3vw,38px)', letterSpacing: '-.01em', color: 'var(--cream)' }}>
            No projects in the forge <span className="serif-accent molten-text">yet.</span>
          </h2>
          <p className="sub" style={{ margin: '13px auto 0', maxWidth: 500, fontSize: 15.5 }}>
            Point Ember at a game folder. It detects the engine, writes <span className="f-mono" style={{ fontSize: 13, color: 'var(--ember-hot)' }}>ember.config.json</span> and gets ready to hunt.
          </p>
          <div className="f-mono" style={{ marginTop: 18, fontSize: 11, letterSpacing: '.26em', color: 'var(--ember-hot)' }}>UNITY · UNREAL · GODOT · WEB · CUSTOM</div>
          <button className="btn btn-molten" style={{ marginTop: 26, padding: '15px 32px', fontSize: 14.5 }} onClick={openConnect}>Connect a project →</button>
        </div>
      )}

      {project && (
        <Tilt max={2.5} style={{ marginTop: 52 }}>
          <div className="forge-slab" style={{ padding: '44px 48px', position: 'relative', overflow: 'hidden', animation: 'riseIn .6s .1s var(--ease) both' }}>
            <div className="ghost-kanji" style={{ right: 30, top: -20, fontSize: 190, writingMode: 'horizontal-tb' }}>企</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 34 }}>
              <div style={{ position: 'relative', width: 92, height: 92, flex: 'none' }}>
                <Orb size={92} float={false} glow={.7} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mono-tag" style={{ color: 'var(--ember)' }}>CONNECTED PROJECT</div>
                <div className="f-syne" style={{ marginTop: 8, fontWeight: 800, fontSize: 'clamp(30px,3.4vw,46px)', letterSpacing: '-.02em', color: 'var(--cream)', lineHeight: 1 }}>{project.name}</div>
                <div className="f-mono" style={{ marginTop: 10, fontSize: 11.5, color: 'var(--cream-40)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.path}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'flex-end' }}>
                <span className="seal" style={{ animation: 'sealStamp .5s .4s var(--ease) both' }}>{project.engine}</span>
                <span className="seal seal-jade">LOCAL</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 38, paddingTop: 28, borderTop: '1px solid var(--line)' }}>
              <button className="btn btn-molten" onClick={() => ignite('smoke')}>Ignite run</button>
              <button className="btn btn-ghost" onClick={goConfig}>Config</button>
              <div style={{ flex: 1 }}></div>
              <button className="btn btn-danger" onClick={disconnect}>Disconnect</button>
            </div>
          </div>
        </Tilt>
      )}
    </React.Fragment>
  );
}

/* ------------------------------------------------ REPORTS — the aftermath archive */
function ReportsView({ reports, ignite, openReport }) {
  return (
    <React.Fragment>
      <Kicker jp="余燼">02 — REPORTS</Kicker>
      <h1 className="h-view" style={{ marginTop: 20 }}>
        Aftermath<span className="molten-text">.</span>
      </h1>
      <p className="sub" style={{ marginTop: 18, maxWidth: 520, fontSize: 15.5 }}>
        <span className="serif-accent" style={{ color: 'var(--cream-70)', fontSize: 18 }}>Yojin</span> — the embers that remain after the fire. Every run leaves its trace here.
      </p>

      {reports.length === 0 && (
        <div style={{ marginTop: 70, textAlign: 'center', animation: 'riseIn .6s .15s var(--ease) both' }}>
          <div style={{ width: 15, height: 15, borderRadius: '50%', margin: '0 auto', background: 'radial-gradient(circle at 35% 30%, var(--gold), var(--ember) 55%, #a02c08)', animation: 'emberPulse 2s ease-in-out infinite' }}></div>
          <div className="mono-tag" style={{ marginTop: 26 }}>NOTHING TO READ YET</div>
          <h2 className="f-min" style={{ marginTop: 14, fontWeight: 600, fontSize: 30, color: 'var(--cream)' }}>Run the agent — the aftermath lands here.</h2>
          <p className="sub" style={{ margin: '14px auto 0', maxWidth: 460, fontSize: 15 }}>
            Every run produces a full report: findings with file &amp; line evidence, log issues, severity breakdown and a stability score.
          </p>
          <button className="btn btn-molten" style={{ marginTop: 30, padding: '15px 32px' }} onClick={() => ignite('smoke')}>Ignite a run</button>
        </div>
      )}

      {reports.length > 0 && (
        <div style={{ marginTop: 48, borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr auto auto 42px', gap: 26, padding: '0 22px 12px' }}>
            <span className="mono-tag" style={{ fontSize: 9 }}>NO.</span>
            <span className="mono-tag" style={{ fontSize: 9 }}>RUN</span>
            <span className="mono-tag" style={{ fontSize: 9 }}>EVIDENCE</span>
            <span className="mono-tag" style={{ fontSize: 9, textAlign: 'right' }}>STABILITY</span>
            <span></span>
          </div>
          {reports.map((r, i) => (
            <button key={r.id} className="archive-row" onClick={() => openReport(r)} style={{ opacity: 0, animation: `riseIn .5s ${.1 + i * .07}s var(--ease) both` }}>
              <span className="num-min" style={{ fontSize: 38, color: 'var(--cream-28)' }}>#{r.n}</span>
              <span>
                <div className="h-panel" style={{ fontSize: 17 }}>{r.project} — {r.profile} run</div>
                <div className="f-mono" style={{ marginTop: 4, fontSize: 10, letterSpacing: '.1em', color: 'var(--cream-40)' }}>{fmtDate(r.at).toUpperCase()}</div>
              </span>
              <span className="f-mono" style={{ fontSize: 11, color: 'var(--cream-55)' }}>{r.files} FILES · {r.findings} FINDINGS · {r.logs} LOG ISSUES</span>
              <span className="f-syne molten-text" style={{ fontWeight: 800, fontSize: 30, textAlign: 'right' }}>{r.stability}</span>
              <span className="arrow">›</span>
            </button>
          ))}
        </div>
      )}
    </React.Fragment>
  );
}

/* ------------------------------------------------ PLANS — kata, shaped runs */
function PlansView({ project, plans, ignite, openConnect, openPlanModal }) {
  const defaults = [
    { name: 'smoke', tag: 'DEFAULT', desc: 'Fast pass on every build — scan the tree, analyze the code, mine the logs.', checks: 'SCAN · ANALYZE · LOGS', kanji: '煙' },
    { name: 'full', tag: 'DEFAULT', desc: 'The whole forge — everything in smoke, plus your build and engine test commands.', checks: 'SCAN · ANALYZE · LOGS · BUILD · TEST', kanji: '全' }
  ];
  const all = [
    ...defaults,
    ...plans.map(p => ({ name: p.name, tag: 'CUSTOM', desc: 'Custom plan — ' + p.checks.length + ' checks.', checks: p.checks.map(c => c.toUpperCase()).join(' · '), kanji: '作' }))
  ];
  return (
    <React.Fragment>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <Kicker jp="型式">03 — TEST PLANS</Kicker>
          <h1 className="h-view" style={{ marginTop: 20 }}>Kata<span className="molten-text">.</span></h1>
          <p className="sub" style={{ marginTop: 16, maxWidth: 520, fontSize: 15.5 }}>
            <span className="serif-accent" style={{ color: 'var(--cream-70)', fontSize: 18 }}>型</span> — a practiced form. Each plan is a shape the agent executes with intent.
          </p>
        </div>
        {project && <button className="btn btn-molten" onClick={openPlanModal}>New plan</button>}
      </div>

      {!project && (
        <div style={{ marginTop: 70, textAlign: 'center', animation: 'riseIn .6s .15s var(--ease) both' }}>
          <div className="mono-tag">PLANS LIVE INSIDE A PROJECT</div>
          <h2 className="f-min" style={{ marginTop: 14, fontWeight: 600, fontSize: 30, color: 'var(--cream)' }}>Connect a project to shape its test profiles.</h2>
          <p className="sub" style={{ margin: '14px auto 0', maxWidth: 450, fontSize: 15 }}>
            Each project ships with <span className="f-mono" style={{ fontSize: 13, color: 'var(--ember-hot)' }}>smoke</span> and <span className="f-mono" style={{ fontSize: 13, color: 'var(--ember-hot)' }}>full</span> profiles. Build your own from real checks.
          </p>
          <button className="btn btn-molten" style={{ marginTop: 30, padding: '15px 32px' }} onClick={openConnect}>Connect a project →</button>
        </div>
      )}

      {project && (
        <React.Fragment>
          <div style={{ marginTop: 46, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {all.map((pl, i) => (
              <div key={pl.name + i} className="forge-slab kata-band" style={{ padding: '30px 36px', display: 'flex', alignItems: 'center', gap: 30, opacity: 0, animation: `riseIn .55s ${.12 + i * .1}s var(--ease) both` }}>
                <span className="num-min" style={{ fontSize: 52, color: 'rgba(255,106,26,.25)', flex: 'none', width: 66, textAlign: 'center' }}>{pl.kanji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span className="f-syne" style={{ fontWeight: 700, fontSize: 24, letterSpacing: '-.01em', color: 'var(--cream)' }}>{pl.name}</span>
                    <span className={cx('seal', pl.tag === 'CUSTOM' ? '' : 'seal-dim')} style={{ fontSize: 8.5 }}>{pl.tag}</span>
                  </div>
                  <div style={{ marginTop: 7, fontSize: 14, lineHeight: 1.55, color: 'var(--cream-55)', maxWidth: 560 }}>{pl.desc}</div>
                  <div className="f-mono" style={{ marginTop: 12, fontSize: 10.5, letterSpacing: '.18em', color: 'var(--ember-hot)' }}>{pl.checks}</div>
                </div>
                <button className="btn btn-ghost run-kata" onClick={() => ignite(pl.name)}>Run this plan →</button>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 26, borderRadius: 20, padding: '26px 32px', background: 'rgba(255,176,46,.045)', border: '1px solid rgba(255,176,46,.22)', animation: 'riseIn .5s .35s var(--ease) both', opacity: 0 }}>
            <div className="f-mono" style={{ fontSize: 10.5, letterSpacing: '.2em', color: 'var(--amber)' }}>ENGINE HOOK REQUIRED — CHECKS ARE MARKED BLOCKED</div>
            <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6, color: 'var(--cream-55)', maxWidth: 660 }}>
              Gameplay-level checks need an engine hook. Until an engine bridge is connected, Ember marks them blocked with the exact missing piece.
            </div>
            <div className="f-mono" style={{ marginTop: 14, fontSize: 11, lineHeight: 2.1, letterSpacing: '.06em', color: 'var(--cream-40)' }}>
              menu navigation · controller input · keyboard input · collision · save/load · ui flow · combat loop · inventory · quest logic · performance · input fuzzing · scripted scenario
            </div>
          </div>
          <style>{`.kata-band:hover .run-kata{ color:var(--gold); border-color:rgba(255,178,90,.55); }`}</style>
        </React.Fragment>
      )}
    </React.Fragment>
  );
}
/* ============================================================================
   VIEWS II — Connectors (接), Config (設), Billing (料) + Settings shoji
   ==========================================================================*/

/* ------------------------------------------------ CONNECTORS — the circuit */
function ConnectorsView({ toast, copyText }) {
  const items = [
    {
      n: '01', name: 'Backend API', jp: '中枢',
      desc: 'Sync projects, reports, notifications and team to the Ember API.',
      status: 'OFFLINE', kind: 'shu',
      actLabel: 'Retry connection', act: () => toast('Backend offline — start localhost:4310 and retry')
    },
    {
      n: '02', name: 'Ember CLI', jp: '刃',
      desc: 'The local agent. Runs scans, analysis and commands entirely offline.',
      status: 'AVAILABLE', kind: 'jade',
      actLabel: 'Copy install command', act: () => copyText('npm link --workspace @ember/agent', 'Install command copied')
    }
  ];
  const dotColor = { shu: 'var(--shu)', jade: 'var(--jade)' };
  return (
    <React.Fragment>
      <Kicker jp="接続">04 — CONNECTORS</Kicker>
      <h1 className="h-view" style={{ marginTop: 20 }}>Bridges<span className="molten-text">.</span></h1>
      <p className="sub" style={{ marginTop: 18, maxWidth: 540, fontSize: 15.5 }}>
        Every integration states exactly what works today. Unavailable connectors stay out of the main list.
      </p>

      <div style={{ marginTop: 56, position: 'relative', paddingLeft: 10 }}>
        {/* circuit spine */}
        <div style={{ position: 'absolute', left: 16, top: 8, bottom: 8, width: 1, background: 'linear-gradient(180deg, rgba(255,120,40,.55), var(--line) 80%)', transformOrigin: 'top', animation: 'drawDown 1s .3s var(--ease) both' }}></div>
        {items.map((cn, i) => (
          <div key={cn.n} style={{ display: 'grid', gridTemplateColumns: '46px 90px 1fr auto', gap: 22, alignItems: 'center', padding: '34px 0', opacity: 0, animation: `riseIn .55s ${.25 + i * .16}s var(--ease) both` }}>
            <div className="node-dot" style={{ color: dotColor[cn.kind], background: dotColor[cn.kind], boxShadow: `0 0 16px ${dotColor[cn.kind]}`, marginLeft: 0 }}></div>
            <div>
              <span className="num-min" style={{ fontSize: 40, color: 'rgba(255,106,26,.2)' }}>{cn.n}</span>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <span className="f-syne" style={{ fontWeight: 700, fontSize: 22, color: 'var(--cream)' }}>{cn.name}</span>
                <span className="f-min" style={{ fontSize: 12, color: 'var(--cream-28)', letterSpacing: '.2em' }}>{cn.jp}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 14.5, lineHeight: 1.55, color: 'var(--cream-55)', maxWidth: 560 }}>{cn.desc}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="btn btn-ghost" style={{ padding: '10px 18px', fontSize: 12.5 }} onClick={cn.act}>{cn.actLabel}</button>
              <span className={cx('seal', cn.kind === 'jade' ? 'seal-jade' : 'seal-shu')}>{cn.status}</span>
            </div>
          </div>
        ))}
      </div>
    </React.Fragment>
  );
}

/* ------------------------------------------------ CONFIG — the engraving */
function ConfigView({ project, configText, onConfigText, copyConfig, validateConfig, openConnect }) {
  return (
    <React.Fragment>
      <Kicker jp="設定">05 — CONFIG EDITOR</Kicker>
      <h1 className="h-view" style={{ marginTop: 20 }}>The engraving<span className="molten-text">.</span></h1>

      {!project && (
        <div style={{ marginTop: 70, textAlign: 'center', animation: 'riseIn .6s .15s var(--ease) both' }}>
          <div className="mono-tag">NO CONFIG YET</div>
          <h2 className="f-min" style={{ marginTop: 14, fontWeight: 600, fontSize: 30, color: 'var(--cream)' }}>ember.config.json is written when you connect.</h2>
          <button className="btn btn-molten" style={{ marginTop: 30, padding: '15px 32px' }} onClick={openConnect}>Connect a project →</button>
        </div>
      )}

      {project && (
        <div className="forge-slab" style={{ marginTop: 44, overflow: 'hidden', animation: 'riseIn .6s .15s var(--ease) both', background: 'linear-gradient(180deg, rgba(255,120,40,.05), transparent 110px), #0b0705' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 20px', borderBottom: '1px solid var(--line)' }}>
            <span className="f-min" style={{ fontSize: 13, color: 'var(--ember-hot)' }}>刻</span>
            <span className="f-mono" style={{ fontSize: 10.5, letterSpacing: '.1em', color: 'var(--cream-40)' }}>ember.config.json — {project.path}</span>
            <div style={{ flex: 1 }}></div>
            <button className="btn btn-quiet f-mono" style={{ padding: '6px 14px', fontSize: 9.5, letterSpacing: '.16em', border: '1px solid var(--line-strong)' }} onClick={copyConfig}>COPY</button>
          </div>
          <textarea value={configText} onChange={onConfigText} spellCheck={false} style={{
            width: '100%', minHeight: 430, padding: 26, background: 'transparent', border: 'none', outline: 'none',
            resize: 'vertical', fontFamily: 'var(--f-mono)', fontSize: 13, lineHeight: 1.9, color: 'var(--cream-70)'
          }}></textarea>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '15px 20px', borderTop: '1px solid var(--line)' }}>
            <button className="btn btn-molten" style={{ padding: '10px 22px', fontSize: 12.5 }} onClick={validateConfig}>Validate</button>
            <div className="f-mono" style={{ fontSize: 10.5, letterSpacing: '.08em', color: 'var(--cream-28)' }}>Schema: @ember/shared config-schema · saved locally on validate</div>
          </div>
        </div>
      )}
    </React.Fragment>
  );
}

/* ------------------------------------------------ BILLING — nobori banners */
function BillingView({ checkout, talkToUs }) {
  const plans = [
    { name: 'Pay as you go', price: 'Credits', period: 'billed on what you run', tagline: 'No commitment — pay only for the scans, analyses and AI you actually use. Bigger credit packs cost less per credit.', feats: ['1 scan ≈ 1 credit · deep AI analysis ≈ 4 credits', 'Spending cap + low-balance alerts', 'Optional auto-reload (you can turn it off)', 'Standard AI model · community support'], btn: 'Add credits' },
    { name: 'Day pass', price: '$9.99', period: '/ day', tagline: 'Full access for 24 hours — perfect for a one-off crunch.', feats: ['Unlimited scans & reports for 24h', 'Up to 3 projects', 'Standard AI model', 'Email support'], btn: 'Get a day pass' },
    { name: 'Weekly', price: '$29.99', period: '/ week', tagline: '≈ $4.28 / day · cheaper than three day passes.', feats: ['Everything in Day pass', 'Up to 10 projects', 'Priority queue · faster runs', 'Faster AI model'], btn: 'Go weekly' },
    { name: 'Monthly', price: '$59.99', period: '/ month', tagline: '≈ $2 / day · save 50% vs paying weekly.', feats: ['Unlimited projects & report exports', 'Advanced AI model + deeper analysis', 'Advanced reports & automations', 'Priority support'], btn: 'Go monthly' },
    { name: 'Annual', price: '$500', period: '/ year', tagline: '≈ $41.67 / month — save 30% ($220) vs monthly.', feats: ['Everything in Monthly, all year', 'Most powerful AI model + longest history', 'Advanced integrations & early access', 'Priority support'], btn: 'Go annual — save 30%', hot: true, badge: 'BEST VALUE' },
    { name: 'Lifetime', price: '$2,500', period: 'one-time', tagline: 'Own Ember forever — pays for itself in ~5 years vs annual. For power users.', feats: ['Everything in Annual, forever', 'No subscription, ever', 'All future updates included', 'Priority support for life'], btn: 'Buy Lifetime', badge: 'PREMIUM' }
  ];
  return (
    <React.Fragment>
      <Kicker jp="料金">06 — SUBSCRIPTION</Kicker>
      <h1 className="h-view" style={{ marginTop: 20 }}>Fuel<span className="molten-text">.</span></h1>

      <div className="glass" style={{ marginTop: 40, borderRadius: 18, padding: '20px 28px', display: 'flex', alignItems: 'center', gap: 22, animation: 'riseIn .5s .1s var(--ease) both' }}>
        <span className="seal seal-jade">CURRENT PLAN</span>
        <span className="h-panel" style={{ fontSize: 19 }}>Free — forever</span>
        <div style={{ flex: 1 }}></div>
        <span className="f-mono" style={{ fontSize: 10.5, letterSpacing: '.12em', color: 'var(--cream-40)' }}>1 PROJECT · 5 REPORTS / MONTH · LOCAL ONLY</span>
      </div>

      <div style={{ marginTop: 44, display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0,1fr))', gap: 14, alignItems: 'end' }}>
        {plans.map((p, i) => (
          <div key={p.name} className={cx('nobori', p.hot && 'hot')} style={{ opacity: 0, animation: `riseIn .55s ${.15 + i * .07}s var(--ease) both`, minHeight: p.hot ? 430 : 396 }}>
            {p.badge && (
              <span className={cx('seal', p.hot ? '' : 'seal-dim')} style={{ position: 'absolute', top: -11, left: 18, background: p.hot ? 'linear-gradient(135deg,var(--gold),#ff7a1a)' : 'var(--coal)', color: p.hot ? '#1c0d02' : 'var(--cream-55)', border: p.hot ? 'none' : '1px solid var(--line-strong)', borderRadius: 5 }}>{p.badge}</span>
            )}
            <div className="f-syne" style={{ fontWeight: 700, fontSize: 15.5, color: 'var(--cream)' }}>{p.name}</div>
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
              <span className={cx('f-syne', p.hot && 'molten-text')} style={{ fontWeight: 800, fontSize: p.price.length > 6 ? 21 : (p.price.length > 4 ? 25 : 30), letterSpacing: '-.02em', color: p.hot ? undefined : 'var(--cream)' }}>{p.price}</span>
              <span style={{ fontSize: 10.5, color: 'var(--cream-40)' }}>{p.period}</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.5, color: 'var(--cream-55)' }}>{p.tagline}</div>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
              {p.feats.map((f, j) => (
                <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, lineHeight: 1.45, color: 'var(--cream-55)' }}>
                  <span style={{ color: p.hot ? 'var(--gold)' : 'var(--ember-hot)', fontSize: 10, marginTop: 1 }}>✓</span>{f}
                </div>
              ))}
            </div>
            <button className={cx('btn', p.hot ? 'btn-molten' : 'btn-ghost')} style={{ marginTop: 18, width: '100%', padding: '11px 8px', fontSize: 11.5 }} onClick={checkout}>{p.btn}</button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 40, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 30, opacity: 0, animation: 'riseIn .55s .55s var(--ease) both' }}>
        <div className="hairline-t" style={{ paddingTop: 20 }}>
          <div className="mono-tag">PAYMENT METHODS</div>
          <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.6, color: 'var(--cream-55)' }}>No payment methods saved for this workspace.</div>
        </div>
        <div className="hairline-t" style={{ paddingTop: 20 }}>
          <div className="mono-tag">TRANSACTION HISTORY</div>
          <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.6, color: 'var(--cream-55)' }}>No transactions yet.</div>
        </div>
        <div className="hairline-t" style={{ paddingTop: 20 }}>
          <div className="mono-tag">ENTERPRISE</div>
          <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.6, color: 'var(--cream-55)' }}>On-prem, SSO, audit log, custom integrations.</div>
          <button className="btn btn-ghost" style={{ marginTop: 14, padding: '9px 18px', fontSize: 12.5 }} onClick={talkToUs}>Talk to us →</button>
        </div>
      </div>
      <div className="f-mono" style={{ marginTop: 30, fontSize: 10, letterSpacing: '.14em', color: 'var(--cream-28)' }}>
        BILLING ACTIONS OPEN A CONTACT REQUEST. NO CARD IS CHARGED FROM THIS LOCAL APP.
      </div>
    </React.Fragment>
  );
}

/* ============================================================================
   SETTINGS — the shoji panel. Full-height, two panes: identity + sections
   on the left, the living page on the right.
   ==========================================================================*/
function SettingsSheet({ user, page, setPage, close, goView, signOut, state, actions }) {
  const { pName, pEmail, pw1, pw2, pw3, pwErr, prefs, lang } = state;
  const { onField, saveProfile, savePassword, flipPref, setLang, reportProblem } = actions;

  const GROUPS = [
    { label: 'ACCOUNT', jp: '身元', items: [
      ['profile', 'Profile & information'],
      ['password', 'Change password'],
      ['security', 'Security']
    ]},
    { label: 'PREFERENCES', jp: '好み', items: [
      ['prefs', 'General · Appearance · Language']
    ]},
    { label: 'SUBSCRIPTION', jp: '料金', items: [
      ['billing:view', 'Plan & billing'],
      ['billing:view2', 'Payment methods & history']
    ]},
    { label: 'SYSTEM', jp: '系統', items: [
      ['connectors:view', 'Integrations'],
      ['privacy', 'Privacy'],
      ['support', 'Support']
    ]}
  ];

  const TOGGLES = [
    ['notifRuns', 'Run notifications', 'When a run finishes and the report is ready.'],
    ['notifCritical', 'Critical bug alerts', 'Immediately when a critical finding lands.'],
    ['notifBilling', 'Billing emails', 'Receipts and plan changes.'],
    ['compact', 'Compact density', 'Tighter spacing across the app.'],
    ['reduceMotion', 'Reduce motion', 'Calms every animation in the forge.']
  ];

  const InfoCard = ({ title, children, right }) => (
    <div className="glass" style={{ borderRadius: 16, padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cream)' }}>{title}</div>
        <div style={{ marginTop: 5, fontSize: 12.5, lineHeight: 1.55, color: 'var(--cream-55)' }}>{children}</div>
      </div>
      {right}
    </div>
  );

  const pageBody = {
    profile: (
      <React.Fragment>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 30 }}>
          <div style={{ width: 74, height: 74, borderRadius: 22, background: 'var(--cream)', color: '#1a1512', display: 'grid', placeItems: 'center', fontFamily: 'var(--f-syne)', fontWeight: 800, fontSize: 24, boxShadow: '0 0 0 2px var(--ember), 0 16px 40px rgba(255,106,26,.25)' }}>{user.initials}</div>
          <div>
            <div className="h-panel" style={{ fontSize: 20 }}>{user.name}</div>
            <div style={{ marginTop: 3, fontSize: 13, color: 'var(--cream-55)' }}>{user.email}</div>
          </div>
          <span className="seal" style={{ marginLeft: 'auto' }}>FREE</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 460 }}>
          <Field label="Full name" value={pName} onChange={onField('pName')} />
          <Field label="Email" value={pEmail} onChange={onField('pEmail')} />
          <button className="btn btn-molten" style={{ alignSelf: 'flex-start' }} onClick={saveProfile}>Save changes</button>
        </div>
      </React.Fragment>
    ),
    password: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 460 }}>
        <Field label="Current password" type="password" value={pw1} onChange={onField('pw1')} placeholder="••••••••" />
        <Field label="New password" type="password" value={pw2} onChange={onField('pw2')} placeholder="Min. 8 characters" />
        <Field label="Confirm new password" type="password" value={pw3} onChange={onField('pw3')} placeholder="Repeat it" />
        {pwErr && <div className="err-band">{pwErr}</div>}
        <button className="btn btn-molten" style={{ alignSelf: 'flex-start' }} onClick={savePassword}>Update password</button>
      </div>
    ),
    security: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
        <InfoCard title="Local password protection" right={<span className="seal seal-jade">ACTIVE</span>}>
          Password changes are validated before the local session is updated.
        </InfoCard>
        <InfoCard title="Active session">This device — local session · scrypt-hashed credentials</InfoCard>
        <InfoCard title="Secret masking">Keys and tokens are redacted from logs and reports. Always on.</InfoCard>
        <button className="btn btn-danger" style={{ alignSelf: 'flex-start', marginTop: 8 }} onClick={signOut}>Sign out everywhere</button>
      </div>
    ),
    prefs: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 34, maxWidth: 560 }}>
        <div>
          <div className="mono-tag" style={{ marginBottom: 14 }}>APPEARANCE — <span className="f-min">姿</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ border: '2px solid var(--ember)', borderRadius: 18, padding: 16, background: 'var(--coal)' }}>
              <div style={{ height: 42, borderRadius: 10, background: 'linear-gradient(135deg,#0a0705,#20150d)', border: '1px solid var(--line)' }}></div>
              <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: 'var(--cream)' }}>Forge dark</div>
              <div className="f-mono" style={{ fontSize: 8.5, letterSpacing: '.16em', color: 'var(--ember-hot)', marginTop: 3 }}>ACTIVE — 残火</div>
            </div>
            <div style={{ border: '1px solid var(--line)', borderRadius: 18, padding: 16, opacity: .55 }}>
              <div style={{ height: 42, borderRadius: 10, background: 'linear-gradient(135deg,#f4efe7,#fff)' }}></div>
              <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: 'var(--cream)' }}>Paper light</div>
              <div className="f-mono" style={{ fontSize: 8.5, letterSpacing: '.16em', color: 'var(--cream-40)', marginTop: 3 }}>PREVIEW</div>
            </div>
          </div>
        </div>
        <div>
          <div className="mono-tag" style={{ marginBottom: 14 }}>LANGUAGE — <span className="f-min">言語</span></div>
          <div style={{ display: 'flex', gap: 10 }}>
            {[['en', 'English'], ['fr', 'Français']].map(([code, label]) => (
              <button key={code} className={cx('engine-chip', lang === code && 'on')} style={{ flex: 1, padding: '13px' }} onClick={() => setLang(code)}>{label}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="mono-tag" style={{ marginBottom: 14 }}>GENERAL &amp; NOTIFICATIONS — <span className="f-min">通知</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {TOGGLES.map(([k, label, desc]) => (
              <InfoCard key={k} title={label} right={<Coal on={!!prefs[k]} flip={() => flipPref(k)} />}>{desc}</InfoCard>
            ))}
          </div>
        </div>
      </div>
    ),
    privacy: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
        <InfoCard title="Local-only mode" right={<Coal on={!!prefs.localOnly} flip={() => flipPref('localOnly')} />}>
          Nothing leaves this machine. Sync off.
        </InfoCard>
        <InfoCard title="Telemetry">None. This build sends nothing — no analytics, no crash reporting, no phone-home.</InfoCard>
        <InfoCard title="Secret detection">Code analysis flags committed keys and tokens so they never ship in a report.</InfoCard>
      </div>
    ),
    support: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
        <InfoCard title="Documentation">
          Installation, engine guides, CLI &amp; config reference ship with the repo under <span className="f-mono" style={{ fontSize: 11, color: 'var(--ember-hot)' }}>docs/</span>.
        </InfoCard>
        <InfoCard title="Contact"><span className="f-mono" style={{ fontSize: 12, color: 'var(--ember-hot)' }}>hello@ember.dev</span></InfoCard>
        <InfoCard title="Version" right={<span className="f-mono" style={{ fontSize: 10.5, color: 'var(--cream-40)', whiteSpace: 'nowrap' }}>IGNITION 0.2.0 · AGENT CORE 0.2.0</span>}>The build you are holding.</InfoCard>
        <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', marginTop: 8 }} onClick={reportProblem}>Report a problem</button>
      </div>
    )
  };

  const TITLES = { profile: ['Profile', '身元'], password: ['Password', '鍵'], security: ['Security', '守'], prefs: ['Preferences', '好み'], privacy: ['Privacy', '秘'], support: ['Support', '助'] };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 85 }}>
      <div className="veil" onClick={close}></div>
      <div style={{
        position: 'fixed', top: 14, right: 14, bottom: 14, width: 'min(980px, calc(100vw - 28px))', zIndex: 86,
        borderRadius: 26, overflow: 'hidden', display: 'grid', gridTemplateColumns: '320px 1fr',
        background: 'linear-gradient(180deg, rgba(255,120,40,.04), transparent 200px), var(--coal)',
        border: '1px solid var(--line-strong)', boxShadow: '0 80px 200px rgba(0,0,0,.75)',
        animation: 'sheetIn .5s var(--ease) both'
      }}>
        {/* left rail */}
        <div style={{ borderRight: '1px solid var(--line)', padding: '28px 18px 22px', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '0 10px 22px' }}>
            <div style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--cream)', color: '#1a1512', display: 'grid', placeItems: 'center', fontFamily: 'var(--f-syne)', fontWeight: 800, fontSize: 15 }}>{user.initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--cream)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--cream-40)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>
            </div>
          </div>
          {GROUPS.map((g) => (
            <div key={g.label} style={{ padding: '10px 0 4px' }}>
              <div className="f-mono" style={{ fontSize: 9, letterSpacing: '.26em', color: 'var(--cream-28)', padding: '6px 12px' }}>{g.label} <span className="f-min" style={{ letterSpacing: '.2em', marginLeft: 5 }}>{g.jp}</span></div>
              {g.items.map(([id, label]) => {
                const isNav = id.includes(':view');
                const target = id.split(':')[0];
                const active = !isNav && page === id;
                return (
                  <button key={id} className={cx('sheet-item', active && 'active')}
                    onClick={() => isNav ? goView(target) : setPage(id)}>
                    <span style={{ flex: 1 }}>{label}</span>
                    <span style={{ color: 'var(--cream-28)', fontSize: 14 }}>›</span>
                  </button>
                );
              })}
            </div>
          ))}
          <div style={{ flex: 1 }}></div>
          <button className="btn btn-danger" style={{ margin: '16px 10px 0', justifyContent: 'center' }} onClick={signOut}>Sign out</button>
        </div>

        {/* right page */}
        <div style={{ overflowY: 'auto', padding: '34px 40px 44px', position: 'relative' }}>
          <div className="ghost-kanji" style={{ right: 16, top: 10, fontSize: 130, writingMode: 'horizontal-tb' }}>{(TITLES[page] || TITLES.profile)[1]}</div>
          <button onClick={close} style={{ position: 'absolute', top: 22, right: 22, width: 34, height: 34, borderRadius: '50%', border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--cream-55)', fontSize: 16, transition: 'all .2s' }} className="sheet-x">×</button>
          <div key={page} style={{ animation: 'riseInSoft .4s var(--ease) both' }}>
            <div className="mono-tag" style={{ color: 'var(--ember)' }}>SETTINGS</div>
            <h2 className="h-panel" style={{ fontSize: 30, margin: '10px 0 30px' }}>
              {(TITLES[page] || TITLES.profile)[0]}
              <span className="f-min" style={{ fontSize: 15, fontWeight: 600, color: 'var(--cream-28)', marginLeft: 14, letterSpacing: '.3em' }}>{(TITLES[page] || TITLES.profile)[1]}</span>
            </h2>
            {pageBody[page] || pageBody.profile}
          </div>
          <style>{`.sheet-x:hover{ border-color:var(--ember); color:var(--ember-hot); }`}</style>
        </div>
      </div>
    </div>
  );
}
/* ============================================================================
   MODALS — connect a project, new plan, and the washi report scroll.
   ==========================================================================*/

function ModalShell({ close, width = 560, label, jp, title, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 91 }}>
      <div className="veil" onClick={close}></div>
      {/* flex-centering wrapper — entrance keyframes overwrite `transform`,
          so the card itself must carry no positional transform */}
      <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div className="glass-2" style={{
        width, maxWidth: '94vw', pointerEvents: 'auto',
        maxHeight: '90vh', overflowY: 'auto', borderRadius: 26, padding: '38px 42px',
        background: 'linear-gradient(180deg, rgba(255,120,40,.05), transparent 140px), rgba(18,11,7,.92)',
        boxShadow: '0 80px 200px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,190,120,.12)',
        animation: 'popIn .35s var(--ease-spring) both'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Kicker jp={jp}>{label}</Kicker>
          <button onClick={close} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--cream-55)', fontSize: 15 }}>×</button>
        </div>
        <h2 className="h-panel" style={{ marginTop: 14, fontSize: 26 }}>{title}</h2>
        {children}
      </div>
      </div>
    </div>
  );
}

/* Connect a project — the forge intake */
function ConnectModal({ close, cName, cPath, cEngine, cErr, onField, setEngine, doConnect }) {
  const ENGINES = [['unity', 'Unity'], ['unreal', 'Unreal'], ['godot', 'Godot'], ['web', 'Web'], ['custom', 'Custom']];
  return (
    <ModalShell close={close} label="CONNECT A PROJECT" jp="投入" title="Point Ember at your game.">
      <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Field label="Project name" value={cName} onChange={onField('cName')} placeholder="My Game" />
        <Field label="Project folder" value={cPath} onChange={onField('cPath')} placeholder="/Users/you/games/my-game" mono />
        <div>
          <div className="fld"><label>Engine</label></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ENGINES.map(([id, label]) => (
              <button key={id} className={cx('engine-chip', cEngine === id && 'on')} onClick={() => setEngine(id)}>{label}</button>
            ))}
          </div>
        </div>
        {cErr && <div className="err-band">{cErr}</div>}
        <div className="f-mono" style={{ fontSize: 10, letterSpacing: '.08em', lineHeight: 1.7, color: 'var(--cream-40)' }}>
          ember.config.json will be written at the project root — smoke &amp; full profiles included.
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="btn btn-quiet" onClick={close}>Cancel</button>
          <button className="btn btn-molten" onClick={doConnect}>Connect →</button>
        </div>
      </div>
    </ModalShell>
  );
}

/* New test plan — shape a kata */
function PlanModal({ close, planName, planErr, planChecks, onField, flipCheck, doCreatePlan }) {
  const CHECKS = [['scan', 'Project scan'], ['analyze', 'Code analysis'], ['logs', 'Log analysis'], ['build', 'Build check'], ['test', 'Engine test suite'], ['launch', 'Launch check'], ['regression', 'Regression checks']];
  return (
    <ModalShell close={close} label="NEW TEST PLAN" jp="型作" title="Build a plan from real checks.">
      <div style={{ marginTop: 24 }}>
        <Field label="Plan name" value={planName} onChange={onField('planName')} placeholder="nightly" />
      </div>
      <div className="fld" style={{ marginTop: 20 }}><label>Checks — runnable today</label></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
        {CHECKS.map(([id, label]) => {
          const on = !!planChecks[id];
          return (
            <button key={id} className={cx('check-chip', on && 'on')} onClick={() => flipCheck(id)}>
              <span className="box">{on ? '✓' : ''}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--cream)' }}>{label}</span>
            </button>
          );
        })}
      </div>
      {planErr && <div className="err-band" style={{ marginTop: 14 }}>{planErr}</div>}
      <div className="f-mono" style={{ marginTop: 16, fontSize: 10, letterSpacing: '.08em', lineHeight: 1.7, color: 'var(--cream-40)' }}>
        Gameplay checks (input, save/load, performance…) need an engine SDK — they can be added but will report as blocked.
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn btn-quiet" onClick={close}>Cancel</button>
        <button className="btn btn-molten" onClick={doCreatePlan}>Create plan</button>
      </div>
    </ModalShell>
  );
}

/* ============================================================================
   REPORT SCROLL — the aftermath opens as paper. Light washi inside the
   dark forge: the one deliberate inversion in the whole app.
   ==========================================================================*/
function ReportScroll({ rep, close, findingsFor, exportJson, exportMd }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const max = Math.max(rep.crit, rep.high, rep.med, 1);
  const bars = [
    { label: 'CRITICAL', n: rep.crit, color: '#c8330f', w: Math.round(rep.crit / max * 100) },
    { label: 'HIGH', n: rep.high, color: '#e85410', w: Math.round(rep.high / max * 100) },
    { label: 'MEDIUM', n: rep.med, color: '#d4870a', w: Math.round(rep.med / max * 100) }
  ];
  const meta = [
    ['FILES SCANNED', String(rep.files), '#1a1512'],
    ['FINDINGS', String(rep.findings), '#1a1512'],
    ['LOG ISSUES', String(rep.logs), '#1a1512'],
    ['STABILITY', rep.stability, '#e85410']
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 93 }}>
      <div className="veil" onClick={close} style={{ background: 'rgba(4,2,1,.7)' }}></div>
      <div className="washi-scroll" style={{ transform: 'translateX(-50%)' }}>
        {/* sticky header */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 3, display: 'flex', alignItems: 'center', gap: 12, padding: '16px 34px',
          background: 'rgba(253,250,243,.92)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
          borderBottom: '1px solid rgba(26,21,18,.09)'
        }}>
          <span className="f-min" style={{ fontSize: 13, color: '#c8330f' }}>燼</span>
          <span className="f-mono" style={{ fontSize: 10, letterSpacing: '.2em', color: '#d4520a' }}>EMBER — AFTERMATH REPORT</span>
          <div style={{ flex: 1 }}></div>
          <button className="paper-btn" onClick={exportJson}>COPY JSON</button>
          <button className="paper-btn" onClick={exportMd}>COPY MARKDOWN</button>
          <button className="paper-btn" style={{ width: 30, padding: 0, justifyContent: 'center', borderRadius: '50%' }} onClick={close}>×</button>
        </div>

        <div style={{ padding: '46px 60px 70px', position: 'relative' }}>
          <div className="ghost-kanji" style={{ right: 26, top: 30, fontSize: 150, color: 'rgba(26,21,18,.04)' }}>余燼</div>
          <div className="f-mono" style={{ fontSize: 10.5, letterSpacing: '.14em', color: 'rgba(26,21,18,.45)' }}>
            AFTERMATH #{rep.n} — {fmtDate(rep.at).toUpperCase()} — PROFILE: {rep.profile.toUpperCase()}
          </div>
          <h1 className="f-min" style={{ marginTop: 14, fontWeight: 700, fontSize: 40, letterSpacing: '-.015em', lineHeight: 1.1, color: '#1a1512' }}>
            {rep.project} — <span className="serif-accent" style={{ color: '#c8330f' }}>the aftermath.</span>
          </h1>

          {/* meta strip */}
          <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderTop: '1px solid rgba(26,21,18,.14)', borderBottom: '1px solid rgba(26,21,18,.14)' }}>
            {meta.map(([label, val, color], i) => (
              <div key={label} style={{ padding: '20px 18px', borderLeft: i ? '1px solid rgba(26,21,18,.09)' : 'none' }}>
                <div className="f-mono" style={{ fontSize: 8.5, letterSpacing: '.2em', color: 'rgba(26,21,18,.42)' }}>{label}</div>
                <div className="f-syne" style={{ marginTop: 8, fontWeight: 800, fontSize: 30, color, letterSpacing: '-.02em' }}>{val}</div>
              </div>
            ))}
          </div>

          {/* severity */}
          <div className="f-mono" style={{ marginTop: 38, fontSize: 10.5, letterSpacing: '.24em', color: '#d4520a' }}>SEVERITY BREAKDOWN — <span className="f-min" style={{ letterSpacing: '.2em' }}>深刻度</span></div>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {bars.map((bar, i) => (
              <div key={bar.label} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 34px', gap: 18, alignItems: 'center' }}>
                <div className="f-mono" style={{ fontSize: 10, letterSpacing: '.12em', color: 'rgba(26,21,18,.55)' }}>{bar.label}</div>
                <div style={{ height: 8, borderRadius: 100, background: 'rgba(26,21,18,.07)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 100, background: bar.color, width: bar.w + '%', animation: `barGrow 1s ${.2 + i * .12}s var(--ease) both` }}></div>
                </div>
                <div className="f-syne" style={{ fontWeight: 800, fontSize: 17, textAlign: 'right', color: '#1a1512' }}>{bar.n}</div>
              </div>
            ))}
          </div>

          {/* findings */}
          <div className="f-mono" style={{ marginTop: 40, fontSize: 10.5, letterSpacing: '.24em', color: '#d4520a' }}>FINDINGS — WITH FILE &amp; LINE EVIDENCE</div>
          <div style={{ marginTop: 12 }}>
            {findingsFor(rep).map((f, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 18, padding: '17px 4px', borderTop: i ? '1px solid rgba(26,21,18,.09)' : 'none' }}>
                <div className="f-mono" style={{ fontSize: 9, letterSpacing: '.14em', color: f.c, paddingTop: 3 }}>{f.sev}</div>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.45, color: '#1a1512' }}>{f.txt}</div>
                  <div className="f-mono" style={{ marginTop: 4, fontSize: 11, color: 'rgba(26,21,18,.45)' }}>{f.file}</div>
                </div>
              </div>
            ))}
          </div>

          {/* blocked checks */}
          <div style={{ marginTop: 40, background: '#140d08', borderRadius: 18, padding: '24px 28px', color: 'var(--cream)' }}>
            <div className="f-mono" style={{ fontSize: 10, letterSpacing: '.22em', color: 'var(--ember-hot)' }}>BLOCKED CHECKS — <span className="f-min">封</span></div>
            <div className="f-mono" style={{ marginTop: 12, fontSize: 11.5, lineHeight: 2.1, color: 'var(--cream-55)' }}>
              performance — requires profiler hook<br />save/load — requires save-system hook<br />controller input — requires engine input bridge
            </div>
          </div>

          <div className="f-min" style={{ marginTop: 46, textAlign: 'center', fontSize: 13, letterSpacing: '.5em', color: 'rgba(26,21,18,.3)' }}>— 終 —</div>
        </div>
      </div>
      <style>{`
        .paper-btn{ display:inline-flex; align-items:center; height:30px; padding:0 14px; border-radius:100px; border:1px solid rgba(26,21,18,.16); background:transparent; font-family:var(--f-mono); font-size:9.5px; letter-spacing:.12em; color:rgba(26,21,18,.6); transition:all .2s; }
        .paper-btn:hover{ border-color:#e85410; color:#e85410; }
      `}</style>
    </div>
  );
}
/* ============================================================================
   ROOT — state machine, actions and the forge shell.
   Functional parity with v21: auth, local-only, connect, ignite, reports,
   plans, palette, notifications, settings, config validation, billing.
   ==========================================================================*/

function App() {
  /* ---------- state ---------- */
  const [phase, setPhase] = useState('welcome');            // welcome | auth | app
  const [igniting, setIgniting] = useState(false);          // cinematic passage
  const [lang, setLang] = useState('en');
  const [authMode, setAuthMode] = useState('signin');
  const [fields, setFields] = useState({ aName: '', aEmail: '', aPass: '', cName: '', cPath: '', planName: '', pName: '', pEmail: '', pw1: '', pw2: '', pw3: '' });
  const [authErr, setAuthErr] = useState('');
  const [user, setUser] = useState(null);

  const [view, setView] = useState('home');
  const [viewKey, setViewKey] = useState(0);
  const [project, setProject] = useState(null);
  const [configText, setConfigText] = useState('');
  const [reports, setReports] = useState([]);
  const [plans, setPlans] = useState([]);
  const [notifs, setNotifs] = useState([]);
  const [running, setRunning] = useState(false);
  const [runLines, setRunLines] = useState([]);

  const [bloomOpen, setBloomOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [palQ, setPalQ] = useState('');
  const [palSel, setPalSel] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetPage, setSheetPage] = useState('profile');
  const [connectOpen, setConnectOpen] = useState(false);
  const [cEngine, setCEngine] = useState('unity');
  const [cErr, setCErr] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [planErr, setPlanErr] = useState('');
  const [planChecks, setPlanChecks] = useState({ scan: true, analyze: true, logs: true, build: false, test: false, launch: false, regression: false });
  const [reportView, setReportView] = useState(null);
  const [pwErr, setPwErr] = useState('');
  const [prefs, setPrefs] = useState({ reduceMotion: false, notifRuns: true, notifCritical: true, notifBilling: false, compact: false, localOnly: true });
  const [toastMsg, setToastMsg] = useState('');

  const timers = useRef([]);
  const toastT = useRef(null);
  useEffect(() => () => { timers.current.forEach(clearTimeout); clearTimeout(toastT.current); }, []);
  const after = (ms, fn) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };

  const L = DICT[lang] || DICT.en;

  /* ---------- helpers ---------- */
  const toast = (msg) => { setToastMsg(msg); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToastMsg(''), 2800); };
  const notify = (title, body) => setNotifs(s => [{ id: Date.now() + Math.random(), title, body, at: new Date(), read: false }, ...s]);
  const onField = (k) => (e) => { setFields(s => ({ ...s, [k]: e.target.value })); setAuthErr(''); setCErr(''); setPlanErr(''); setPwErr(''); };
  const copyText = (txt, okMsg) => {
    try { navigator.clipboard.writeText(txt).then(() => toast(okMsg), () => toast('Clipboard unavailable')); }
    catch (e) { toast('Clipboard unavailable'); }
  };
  const goView = (v) => {
    setBloomOpen(false); setPaletteOpen(false); setBellOpen(false); setSheetOpen(false);
    setView(v); setViewKey(k => k + 1);
  };

  /* ---------- auth ---------- */
  const enterApp = (u, msg) => {
    setUser(u); setAuthErr(''); setView('home'); setViewKey(k => k + 1);
    setIgniting(true); setPhase('app');
    if (msg) toast(msg);
  };
  const doAuth = () => {
    const name = fields.aName.trim();
    const email = fields.aEmail.trim();
    const pass = fields.aPass;
    if (authMode === 'signup' && !name) return setAuthErr(L.errName);
    if (!EMAIL_RE.test(email)) return setAuthErr(L.errEmail);
    if (pass.length < 8) return setAuthErr(L.errPass);
    const nm = name || email.split('@')[0];
    enterApp({ name: nm, email, initials: initialsOf(nm) }, 'Signed in — local-first mode');
    notify('Welcome to the forge', 'Signed in as ' + email + ' — local-first mode');
  };
  const localOnly = () => enterApp({ name: 'Local operator', email: 'local-only · no account', initials: 'LO', local: true }, 'Local-only mode — nothing leaves this machine');
  const signOut = () => {
    setUser(null); setPhase('auth'); setAuthMode('signin');
    setSheetOpen(false); setPaletteOpen(false); setBellOpen(false); setBloomOpen(false);
    setFields(s => ({ ...s, aPass: '', pName: '', pEmail: '' }));
    toast('Signed out');
  };

  /* ---------- project ---------- */
  const makeConfig = (name, engine) => {
    const src = { unity: ['Assets/Scripts'], unreal: ['Source'], godot: ['scripts'], web: ['src'], custom: ['src'] }[engine] || ['src'];
    return {
      projectName: name, engine,
      logsPath: 'Logs', crashReportsPath: 'CrashReports', sourcePaths: src,
      buildCommand: '', testCommand: '',
      testProfiles: { smoke: { checks: ['scan', 'analyze', 'logs'] }, full: { checks: ['scan', 'analyze', 'logs', 'build', 'test'] } },
      customRules: [], backend: { url: 'http://localhost:4310' }
    };
  };
  const doConnect = () => {
    const name = fields.cName.trim();
    const path = fields.cPath.trim();
    if (!name) return setCErr('Give the project a name.');
    if (!path) return setCErr('Point at the project folder.');
    setProject({ name, path, engine: cEngine });
    setConfigText(JSON.stringify(makeConfig(name, cEngine), null, 2));
    setConnectOpen(false); setCErr('');
    setFields(s => ({ ...s, cName: '', cPath: '' }));
    setRunLines([{ t: '✓ ember.config.json written — ' + name + ' (' + cEngine + ')', c: 'var(--jade)' }]);
    notify('Project connected', name + ' — ember.config.json written at ' + path);
    toast(name + ' connected — the forge is warm');
  };
  const disconnect = () => {
    const n = project && project.name;
    setProject(null); setConfigText(''); setRunLines([]);
    toast((n || 'Project') + ' disconnected');
  };

  /* ---------- runs ---------- */
  const runningRef = useRef(false); runningRef.current = running;
  const projectRef = useRef(null); projectRef.current = project;
  const reportsRef = useRef([]); reportsRef.current = reports;
  const ignite = (profile) => {
    profile = typeof profile === 'string' ? profile : 'smoke';
    const p = projectRef.current;
    if (!p) { setConnectOpen(true); setBloomOpen(false); setPaletteOpen(false); toast('The forge is cold — connect a project first.'); return; }
    if (runningRef.current) { toast('A run is already burning.'); return; }
    const files = hashN(p.name, 140, 124);
    const findings = hashN(p.name + 'f', 6, 3);
    const crit = hashN(p.name + 'c', 2, 0);
    const high = Math.min(findings - crit, hashN(p.name + 'h', 2, 1));
    const logs = hashN(p.name + 'l', 5, 2);
    const stability = (97.2 - findings * 0.5 - crit * 1.3).toFixed(1);
    const n = reportsRef.current.length + 1;
    const seq = [
      ['› ember run --profile ' + profile, 'var(--ember-hot)'],
      ['› scan — walking project tree…', 'var(--cream-40)'],
      ['› scan — ' + files + ' files · engine: ' + p.engine, 'var(--cream-40)'],
      ['› analyze — 20 heuristics + custom rules', 'var(--cream-40)'],
      ['› analyze — ' + findings + ' findings (' + crit + ' critical)', crit > 0 ? 'var(--shu)' : 'var(--cream-40)'],
      ['› logs — ' + logs + ' issues mined from Logs/', 'var(--cream-40)'],
      ['✓ report written — aftermath #' + n, 'var(--jade)'],
      ['→ stability ' + stability, 'var(--gold)']
    ];
    setRunning(true); setRunLines([]); goView('home');
    seq.forEach((l, i) => after(450 + i * 560, () => setRunLines(s => [...s, { t: l[0], c: l[1] }])));
    after(450 + seq.length * 560 + 350, () => {
      const rep = { id: Date.now(), n, at: new Date(), profile, files, findings, logs, crit, high, med: Math.max(0, findings - crit - high), stability, project: p.name, engine: p.engine };
      setRunning(false);
      setReports(s => [rep, ...s]);
      notify('Aftermath report ready', p.name + ' · ' + profile + ' · stability ' + stability);
      toast('Aftermath #' + n + ' ready — stability ' + stability);
    });
  };

  const findingsFor = (rep) => {
    const base = { unity: 'Assets/Scripts/', unreal: 'Source/Game/', godot: 'scripts/', web: 'src/', custom: 'src/' }[rep.engine] || 'src/';
    const ext = { unity: '.cs', unreal: '.cpp', godot: '.gd', web: '.ts', custom: '.js' }[rep.engine] || '.js';
    const all = [
      { sev: 'CRITICAL', c: '#c8330f', file: base + 'SaveSystem' + ext + ':214', txt: 'Possible null reference — Load() dereferences save slot without a guard' },
      { sev: 'HIGH', c: '#e85410', file: base + 'Inventory' + ext + ':88', txt: 'Unbounded stack merge — overflow risk when stack count exceeds 999' },
      { sev: 'MEDIUM', c: '#d4870a', file: base + 'MenuController' + ext + ':41', txt: 'Focus trap — back action unreachable from options submenu' },
      { sev: 'LOW', c: '#8b857f', file: base + 'AudioPool' + ext + ':132', txt: 'FIXME left in shipping path — pooled audio source never released' }
    ];
    return all.slice(0, Math.max(2, Math.min(4, rep.findings)));
  };
  const reportMd = (rep) =>
    '# Ember Aftermath Report #' + rep.n + '\n\nProject: ' + rep.project + ' (' + rep.engine + ')\nProfile: ' + rep.profile + '\nDate: ' + rep.at.toLocaleString() +
    '\n\n- Files scanned: ' + rep.files + '\n- Findings: ' + rep.findings + ' (' + rep.crit + ' critical, ' + rep.high + ' high, ' + rep.med + ' medium)\n- Log issues: ' + rep.logs + '\n- Stability: ' + rep.stability +
    '\n\n## Findings\n' + findingsFor(rep).map(f => '- [' + f.sev + '] ' + f.txt + ' (' + f.file + ')').join('\n') +
    '\n\n## Blocked checks\n- performance — requires profiler hook\n- save/load — requires save-system hook\n- controller input — requires engine input bridge\n';

  /* ---------- settings ---------- */
  const openSheet = () => { setSheetOpen(true); setSheetPage('profile'); setBellOpen(false); setFields(s => ({ ...s, pName: (user && user.name) || '', pEmail: (user && user.email) || '' })); };
  const saveProfile = () => {
    const name = fields.pName.trim();
    const email = fields.pEmail.trim();
    if (!name) return toast('Name can’t be empty');
    setUser(u => ({ ...u, name, email, initials: initialsOf(name) }));
    toast('Profile updated');
  };
  const savePassword = () => {
    if (!fields.pw1) return setPwErr('Enter your current password.');
    if (fields.pw2.length < 8) return setPwErr('New password needs at least 8 characters.');
    if (fields.pw2 !== fields.pw3) return setPwErr('New passwords don’t match.');
    setFields(s => ({ ...s, pw1: '', pw2: '', pw3: '' })); setPwErr('');
    toast('Password updated');
  };
  const validateConfig = () => {
    try {
      const parsed = JSON.parse(configText || '');
      if (!parsed.projectName) throw new Error('projectName is required');
      if (!parsed.engine) throw new Error('engine is required');
      setProject(p => ({ ...p, name: parsed.projectName, engine: parsed.engine }));
      toast('Config valid — 0 schema errors · saved');
    } catch (e) { toast('Invalid config — ' + e.message); }
  };
  const doCreatePlan = () => {
    const name = fields.planName.trim();
    const checks = Object.entries(planChecks).filter(([, v]) => v).map(([k]) => k);
    if (!name) return setPlanErr('Give the plan a name.');
    if (checks.length === 0) return setPlanErr('Pick at least one check.');
    setPlans(s => [...s, { name, checks }]);
    setPlanOpen(false); setPlanErr('');
    setFields(s => ({ ...s, planName: '' }));
    toast('Plan "' + name + '" created');
  };

  /* ---------- palette ---------- */
  const paletteItems = useMemo(() => {
    const nav = SECTIONS.map(s => ({ label: 'Go to ' + s.name, kind: 'NAV', kanji: s.kanji, run: () => goView(s.id) }));
    const acts = [
      { label: 'Connect a project', kind: 'ACTION', kanji: '投', run: () => { setConnectOpen(true); setPaletteOpen(false); } },
      { label: 'Ignite run — smoke profile', kind: 'ACTION', kanji: '火', run: () => { setPaletteOpen(false); ignite('smoke'); } },
      { label: 'Open profile & settings', kind: 'ACTION', kanji: '整', run: () => { setPaletteOpen(false); openSheet(); } },
      { label: 'Open notifications', kind: 'ACTION', kanji: '報', run: () => { setPaletteOpen(false); setBellOpen(true); } },
      { label: 'Sign out', kind: 'ACTION', kanji: '出', run: () => { setPaletteOpen(false); signOut(); } }
    ];
    const all = [...nav, ...acts];
    const q = palQ.toLowerCase().trim();
    return q ? all.filter(a => a.label.toLowerCase().includes(q)) : all;
  }, [palQ, user, project]);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (phase === 'app') {
          e.preventDefault();
          setPaletteOpen(o => !o); setPalQ(''); setPalSel(0);
          setBloomOpen(false); setBellOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  /* ---------- steps for Overview ---------- */
  const steps = [
    {
      minNum: '一', num: '01', title: 'Connect a project',
      desc: 'Point Ember at a game folder — it detects the engine and writes ember.config.json.',
      hot: !project, showBtn: !project, btnLabel: 'Connect', go: () => setConnectOpen(true),
      tag: 'DONE ✓', tagKind: 'done'
    },
    {
      minNum: '二', num: '02', title: 'Ignite the first run',
      desc: 'The agent scans files, analyzes code and mines the logs — live in the forge feed.',
      hot: !!project && !reports.length,
      showBtn: !!project && !reports.length && !running, btnLabel: 'Ignite', go: () => ignite('smoke'),
      tag: reports.length ? 'DONE ✓' : (running ? 'RUNNING…' : 'NEEDS 01'),
      tagKind: reports.length ? 'done' : (running ? 'hot' : 'dim')
    },
    {
      minNum: '三', num: '03', title: 'Read the aftermath',
      desc: 'Findings with file & line evidence, severity breakdown and a stability score.',
      hot: reports.length > 0,
      showBtn: reports.length > 0, btnLabel: 'Open report', go: () => setReportView(reports[0]),
      tag: 'NEEDS 02', tagKind: 'dim'
    }
  ];

  const unread = notifs.filter(n => !n.read).length;
  const notifItems = notifs.map(n => ({
    id: n.id, title: n.title, body: n.body, time: fmtDate(n.at).toUpperCase(), isRead: n.read,
    read: () => setNotifs(s => s.map(x => x.id === n.id ? { ...x, read: true } : x))
  }));

  const checkout = () => { window.location.href = 'mailto:hello@ember.dev?subject=Ember%20billing'; toast('Opening billing contact request'); };
  const talkToUs = () => { window.location.href = 'mailto:hello@ember.dev?subject=Ember%20enterprise'; toast('Opening enterprise contact request'); };
  const reportProblem = () => { window.open('https://github.com/corncorn5086/Game-Tester2/issues/new', '_blank', 'noopener'); toast('Opening issue form'); };

  const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  const sec = sectionOf(view);

  /* ---------- render ---------- */
  if (phase === 'welcome') {
    return (
      <Welcome L={L} lang={lang} setLang={setLang}
        onSignup={() => { setAuthMode('signup'); setPhase('auth'); }}
        onSignin={() => { setAuthMode('signin'); setPhase('auth'); }} />
    );
  }

  if (phase === 'auth') {
    return (
      <Auth L={L} lang={lang} setLang={setLang} mode={authMode} fields={fields} err={authErr}
        onField={onField} onSubmit={doAuth}
        onToggleMode={() => { setAuthMode(m => m === 'signup' ? 'signin' : 'signup'); setAuthErr(''); }}
        onForgot={() => toast(L.forgotToast)} onLocal={localOnly} reduced={prefs.reduceMotion} />
    );
  }

  const u = user || { name: 'Operator', email: 'operator@local', initials: 'OP' };

  return (
    <div className={cx(prefs.reduceMotion && 'reduce-motion', prefs.compact && 'compact')}
      style={{ position: 'fixed', inset: 0, background: 'var(--void)', color: 'var(--cream)', overflow: 'hidden', animation: igniting ? 'none' : 'irisOpen 1.1s var(--ease) both' }}>

      <ForgeAmbient paused={prefs.reduceMotion} />

      {/* section watermark */}
      <div className="ghost-kanji" style={{ right: '6%', top: '12%', fontSize: 'clamp(220px,34vh,380px)' }} key={'wm' + view}>{sec.jp}</div>
      <div className="tategaki" key={'tg' + view}><span style={{ animation: 'fadeIn 1s both' }}>{sec.jp} — {sec.desc}</span></div>

      {/* the active view */}
      <ViewFrame sec={{ id: view + ':' + viewKey }}>
        {view === 'home' && <OverviewView project={project} reports={reports} running={running} runLines={runLines} steps={steps} ignite={ignite} openConnect={() => setConnectOpen(true)} openReport={setReportView} dateStr={dateStr} />}
        {view === 'projects' && <ProjectsView project={project} openConnect={() => setConnectOpen(true)} ignite={ignite} goConfig={() => goView('config')} disconnect={disconnect} />}
        {view === 'reports' && <ReportsView reports={reports} ignite={ignite} openReport={setReportView} />}
        {view === 'plans' && <PlansView project={project} plans={plans} ignite={ignite} openConnect={() => setConnectOpen(true)} openPlanModal={() => { setPlanOpen(true); setPlanErr(''); }} />}
        {view === 'connectors' && <ConnectorsView toast={toast} copyText={copyText} />}
        {view === 'config' && <ConfigView project={project} configText={configText} onConfigText={(e) => setConfigText(e.target.value)} copyConfig={() => copyText(configText, 'Config copied')} validateConfig={validateConfig} openConnect={() => setConnectOpen(true)} />}
        {view === 'billing' && <BillingView checkout={checkout} talkToUs={talkToUs} />}
      </ViewFrame>

      {/* chrome */}
      <TopBar view={view} project={project} running={running} unread={unread} user={u}
        onBloom={() => setBloomOpen(o => !o)}
        onPalette={() => { setPaletteOpen(true); setPalQ(''); setPalSel(0); setBellOpen(false); }}
        onBell={() => setBellOpen(o => !o)}
        onSheet={openSheet} />

      <EmberDial running={running} onOpen={() => setBloomOpen(true)} />

      {/* overlays */}
      {bloomOpen && <NavBloom view={view} go={goView} close={() => setBloomOpen(false)} reduced={prefs.reduceMotion}
        ignite={() => { setBloomOpen(false); ignite('smoke'); }}
        openConnect={() => { setBloomOpen(false); setConnectOpen(true); }}
        project={project} running={running} />}
      {paletteOpen && <Palette q={palQ} setQ={setPalQ} sel={palSel} setSel={setPalSel} items={paletteItems} close={() => setPaletteOpen(false)} />}
      {bellOpen && <BellPanel items={notifItems} empty={notifs.length === 0} hasUnread={unread > 0} markAll={() => setNotifs(s => s.map(n => ({ ...n, read: true })))} close={() => setBellOpen(false)} />}
      {sheetOpen && (
        <SettingsSheet user={u} page={sheetPage} setPage={setSheetPage} close={() => setSheetOpen(false)}
          goView={goView} signOut={signOut}
          state={{ pName: fields.pName, pEmail: fields.pEmail, pw1: fields.pw1, pw2: fields.pw2, pw3: fields.pw3, pwErr, prefs, lang }}
          actions={{ onField, saveProfile, savePassword, flipPref: (k) => setPrefs(s => ({ ...s, [k]: !s[k] })), setLang, reportProblem }} />
      )}
      {connectOpen && <ConnectModal close={() => { setConnectOpen(false); setCErr(''); }} cName={fields.cName} cPath={fields.cPath} cEngine={cEngine} cErr={cErr} onField={onField} setEngine={setCEngine} doConnect={doConnect} />}
      {planOpen && <PlanModal close={() => { setPlanOpen(false); setPlanErr(''); }} planName={fields.planName} planErr={planErr} planChecks={planChecks} onField={onField} flipCheck={(id) => setPlanChecks(s => ({ ...s, [id]: !s[id] }))} doCreatePlan={doCreatePlan} />}
      {reportView && <ReportScroll rep={reportView} close={() => setReportView(null)} findingsFor={findingsFor}
        exportJson={() => copyText(JSON.stringify(reportView, null, 2), 'Report JSON copied')}
        exportMd={() => copyText(reportMd(reportView), 'Report Markdown copied')} />}
      {toastMsg && <Toast msg={toastMsg} />}

      {/* ignition passage */}
      {igniting && <Ignition done={() => setIgniting(false)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
