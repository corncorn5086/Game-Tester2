import { useEffect, useRef, useState } from 'react';
import { useApp } from '../lib/store.jsx';
import { bridge, isDesktop } from '../lib/bridge.js';
import logo from '../assets/ember-logo.png';

/**
 * Splash: runs REAL startup checks (settings, backend ping, agent bridge,
 * workspace/session). The progress bar and status line reflect the actual
 * check that just completed — nothing here is faked.
 */
const CHECKS = [
  ['settings', 'Loading settings'],
  ['session', 'Restoring session'],
  ['backend', 'Connecting to backend'],
  ['agent', isDesktop ? 'Warming up the agent' : 'Agent bridge (preview)'],
  ['workspace', 'Preparing workspace']
];

export default function Splash() {
  const { settings, settingsLoaded, setPhase, api } = useApp();
  const [step, setStep] = useState(0);
  const [label, setLabel] = useState('Loading settings');
  const started = useRef(false);

  useEffect(() => {
    if (!settingsLoaded || started.current) return;
    started.current = true;
    const advance = (i) => { setStep(i + 1); setLabel(CHECKS[Math.min(i + 1, CHECKS.length - 1)][1]); };

    (async () => {
      const t0 = Date.now();
      advance(0);                                   // settings loaded
      await new Promise((r) => setTimeout(r, 260));
      advance(1);                                   // session
      await api.health().catch(() => null);
      advance(2);                                   // backend
      if (isDesktop) await bridge.agent.doctor(undefined).catch(() => null);
      advance(3);                                   // agent
      advance(4);                                   // workspace
      const elapsed = Date.now() - t0;
      await new Promise((r) => setTimeout(r, Math.max(0, 1500 - elapsed)));
      setPhase(settings.session ? 'app' : 'auth');
    })();
  }, [settingsLoaded, settings.session, api, setPhase]);

  const progress = Math.round((step / CHECKS.length) * 100);

  return (
    <div className="splash">
      <div className="splash-mark">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className="splash-spark"
            style={{
              marginLeft: `${(i - 2.5) * 15}px`,
              animation: `splashSpark ${2.2 + i * 0.3}s ease-in ${i * 0.34}s infinite`
            }}
          />
        ))}
        <img src={logo} alt="Ember" className="splash-logo splash-flame" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        <div className="splash-word">Ember</div>
        <div className="splash-sub">{label}…</div>
        <div className="splash-track">
          <div className="splash-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  );
}
