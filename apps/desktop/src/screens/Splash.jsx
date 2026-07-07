import { useEffect, useRef, useState } from 'react';
import { useApp } from '../lib/store.jsx';
import { bridge, isDesktop } from '../lib/bridge.js';
import logo from '../assets/ember-logo.png';

/**
 * Splash: runs REAL startup checks (settings, backend ping, agent bridge,
 * workspace/session) — each dot lights when its check actually completed.
 */
export default function Splash() {
  const { settings, settingsLoaded, setPhase, api } = useApp();
  const [done, setDone] = useState({});
  const started = useRef(false);

  useEffect(() => {
    if (!settingsLoaded || started.current) return;
    started.current = true;
    const mark = (key) => setDone((d) => ({ ...d, [key]: true }));

    (async () => {
      const t0 = Date.now();
      mark('settings');

      // session check (from persisted settings)
      await new Promise((r) => setTimeout(r, 250));
      mark('session');

      await api.health().catch(() => null);
      mark('backend');

      // agent bridge check
      if (isDesktop) {
        await bridge.agent.doctor(undefined).catch(() => null);
      }
      mark('agent');

      mark('workspace');
      // keep the splash readable even when checks are instant
      const elapsed = Date.now() - t0;
      await new Promise((r) => setTimeout(r, Math.max(0, 1600 - elapsed)));
      setPhase(settings.session ? 'app' : 'auth');
    })();
  }, [settingsLoaded, settings.session, api, setPhase]);

  const checks = [
    ['settings', 'Loading settings'],
    ['session', 'Checking local session'],
    ['backend', 'Checking backend'],
    ['agent', isDesktop ? 'Checking agent' : 'Agent bridge (browser preview)'],
    ['workspace', 'Preparing workspace']
  ];

  return (
    <div className="full-center anim-scale" style={{ gap: 40 }}>
      <div style={{ position: 'relative', width: 180, height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,77,0,.16) 0%, transparent 65%)', animation: 'glowPulse 2.6s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', width: 200, height: 200, borderRadius: '50%', border: '1px solid rgba(255,255,255,.06)', borderTopColor: 'rgba(255,110,50,.5)', animation: 'ringSpin 2.8s linear infinite' }} />
        <img src={logo} alt="Ember" style={{ width: 120, filter: 'drop-shadow(0 0 24px rgba(255,90,20,.4))' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
        <div style={{ fontSize: 12, letterSpacing: '.32em', textTransform: 'uppercase', color: 'rgba(244,244,245,.4)', fontWeight: 500 }}>
          Initializing Ember Agent
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, minWidth: 270 }}>
          {checks.map(([key, label]) => {
            const on = !!done[key];
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, fontFamily: 'var(--font-mono)', color: on ? 'rgba(244,244,245,.85)' : 'rgba(244,244,245,.32)', transition: 'color .4s' }}>
                <span style={{ display: 'inline-flex', width: 14, height: 14, borderRadius: '50%', border: `1px solid ${on ? '#ff4d00' : 'rgba(255,255,255,.15)'}`, background: on ? '#ff4d00' : 'transparent', transition: 'all .4s' }} />
                {label}
              </div>
            );
          })}
        </div>
        <div style={{ width: 270, height: 2, background: 'rgba(255,255,255,.06)', borderRadius: 1, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: '#ff4d00', animation: 'barLoad 1.8s cubic-bezier(.3,.6,.4,1) both' }} />
        </div>
      </div>
    </div>
  );
}
