import { useMemo, useState } from 'react';
import { ENGINES } from '@ember/shared/engines';
import { useApp } from '../lib/store.jsx';
import { bridge, isDesktop } from '../lib/bridge.js';
import logo from '../assets/ember-logo.png';

/**
 * 8-step onboarding (design/desktop-v2). Every action is real in the desktop
 * shell: folder pick + engine detection, config generation, ember doctor,
 * first scan. Browser preview states its limits instead of simulating.
 */
const WORKFLOWS = [
  ['Connect existing game project', 'Point Ember at your working copy — code, assets, logs.', 'available', '◈'],
  ['Connect build folder', 'Attach a packaged build for launch + runtime checks.', 'available', '▣'],
  ['Connect Git repository', 'Clone locally first — direct remote cloning is coming soon.', 'coming soon', '⎇'],
  ['Install Ember Agent only', 'CLI-first setup: npm link --workspace @ember/agent.', 'available', '⌁']
];

const ENGINE_CARDS = [
  ['unity', 'Unity', 'Assets/ · *.cs · Player.log', 'Full support', 'var(--ok)'],
  ['unreal', 'Unreal Engine', 'Content/ · *.cpp · Saved/Logs', 'Full support', 'var(--ok)'],
  ['godot', 'Godot', 'project.godot · *.gd · godot.log', 'Beta', 'var(--warn)'],
  ['web', 'Web Game', 'package.json · *.js *.ts · console logs', 'Beta', 'var(--warn)'],
  ['custom', 'Custom Engine', 'Your paths, your patterns — via config', 'Config-driven', 'var(--accent-soft)'],
  ['auto', 'Auto-detect', 'Ember infers the engine from files', 'Recommended', 'var(--info)']
];

export default function Onboarding() {
  const { setPhase, saveSettings, connectProject, toast, settings } = useApp();
  const [step, setStep] = useState(1);
  const [engine, setEngine] = useState('auto');
  const [path, setPath] = useState(settings.defaultProjectFolder || '');
  const [scanInfo, setScanInfo] = useState(null); // { detection, dir }
  const [configDone, setConfigDone] = useState(false);
  const [configPreview, setConfigPreview] = useState(null);
  const [doctorRes, setDoctorRes] = useState(null);
  const [firstScan, setFirstScan] = useState(null);
  const [busy, setBusy] = useState(false);

  const next = () => setStep((s) => Math.min(8, s + 1));
  const back = () => setStep((s) => Math.max(1, s - 1));
  const skip = async () => {
    await saveSettings({ onboarded: true });
    setPhase('app');
  };

  const pickFolder = async () => {
    let dir = path;
    if (isDesktop) {
      const chosen = await bridge.selectFolder('Select your game project folder');
      if (chosen) dir = chosen;
    }
    if (!dir) return toast(isDesktop ? 'No folder selected' : 'Type a project path — the native picker needs the desktop shell');
    setPath(dir);
    setBusy(true);
    const detection = await bridge.project.detect(dir);
    setBusy(false);
    if (detection?.unavailable || detection?.error) {
      setScanInfo({ dir, detection: null, unavailable: true });
      return toast('Browser preview — detection needs the desktop shell (npm run dev:desktop)');
    }
    setScanInfo({ dir, detection });
    if (engine === 'auto') setEngine(detection.engine);
    toast(`Engine detected: ${detection.engine} (${detection.confidence})`);
  };

  const genConfig = async () => {
    if (!scanInfo?.dir) return toast('Connect a folder first (step 4)');
    setBusy(true);
    const res = await bridge.config.generate(scanInfo.dir, engine === 'auto' ? {} : { engine });
    setBusy(false);
    if (res?.unavailable) return toast(res.error);
    if (res?.error && !res.written) {
      // config already exists — that's fine, load it
      setConfigDone(true);
      setConfigPreview(JSON.stringify(res.config, null, 2));
      return toast('ember.config.json already exists — using it');
    }
    setConfigDone(true);
    setConfigPreview(JSON.stringify(res.config, null, 2));
    toast('ember.config.json written to project root');
  };

  const runDoctor = async () => {
    setBusy(true);
    const res = await bridge.agent.doctor(scanInfo?.dir);
    setBusy(false);
    if (res?.unavailable || res?.error) return toast(res.error ?? 'doctor unavailable in browser preview');
    setDoctorRes(res);
    toast(`ember doctor — ${res.checks.length - res.failed - res.warned} ok, ${res.warned} warning(s), ${res.failed} failing`);
  };

  const runFirstScan = async () => {
    if (!scanInfo?.dir) return toast('Connect a folder first (step 4)');
    setBusy(true);
    const res = await bridge.agent.scan(scanInfo.dir);
    setBusy(false);
    if (res?.error) return toast(res.error);
    setFirstScan(res);
  };

  const finish = async () => {
    if (scanInfo?.dir && configDone) await connectProject(scanInfo.dir);
    await saveSettings({ onboarded: true });
    setPhase('app');
  };

  const previewConfig = useMemo(() => {
    if (configPreview) return configPreview;
    const eng = engine === 'auto' ? (scanInfo?.detection?.engine ?? 'unity') : engine;
    const profile = ENGINES[eng] ?? ENGINES.custom;
    return JSON.stringify({
      projectName: (scanInfo?.dir ?? path ?? 'my-game').split(/[\\/]/).pop() || 'my-game',
      engine: eng,
      gamePath: '.',
      logsPath: '',
      sourcePaths: profile.analyze.sourcePaths,
      ignorePaths: profile.analyze.ignorePaths,
      testProfiles: { smoke: { checks: ['scan', 'analyze', 'logs'] } }
    }, null, 2);
  }, [configPreview, engine, scanInfo, path]);

  const card = (selected) => ({
    padding: 20, borderRadius: 14, cursor: 'pointer', transition: 'all .22s',
    background: selected ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.02)',
    border: `1px solid ${selected ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.07)'}`
  });

  const finishList = [
    ['Project connected', !!scanInfo?.dir],
    [`Engine: ${engine === 'auto' ? scanInfo?.detection?.engine ?? 'auto-detect' : engine}`, true],
    ['ember.config.json valid', configDone],
    [`Agent checks: ${doctorRes ? `${doctorRes.checks.length - doctorRes.failed} passed` : 'not run'}`, !!doctorRes],
    ['Next: run your first full analysis', true]
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '44px 40px 40px', overflow: 'auto' }}>
      {/* progress header */}
      <div style={{ width: 720, maxWidth: '100%', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 38 }}>
        <img src={logo} alt="" style={{ width: 28 }} />
        <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,.06)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${(step / 8) * 100}%`, background: '#ff4d00', borderRadius: 2, transition: 'width .5s cubic-bezier(.4,0,.2,1)' }} />
        </div>
        <div className="micro-mono">Step {step} / 8</div>
        <button onClick={skip} style={{ border: 'none', background: 'transparent', color: 'rgba(244,244,245,.35)', fontSize: 11.5, cursor: 'pointer' }}>Skip</button>
      </div>

      <div key={step} className="anim-left" style={{ width: 720, maxWidth: '100%' }}>
        {step === 1 && (
          <div style={{ textAlign: 'center', padding: '34px 0 10px' }}>
            <img src={logo} alt="" style={{ width: 88, filter: 'drop-shadow(0 0 22px rgba(255,90,20,.4))' }} />
            <h1 style={{ fontSize: 38, fontWeight: 600, margin: '20px 0 12px', letterSpacing: '-.03em' }}>Welcome to Ember</h1>
            <p style={{ fontSize: 14.5, lineHeight: 1.7, color: 'rgba(244,244,245,.5)', maxWidth: 500, margin: '0 auto 32px' }}>
              Ember connects to your game project, scans code and logs, runs configured checks, detects issues and generates QA reports.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn btn-white" onClick={next}>Start setup</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <>
            <h2 style={{ fontSize: 26, fontWeight: 600, margin: '0 0 6px', letterSpacing: '-.02em' }}>Choose your workflow</h2>
            <p style={{ fontSize: 13, color: 'rgba(244,244,245,.45)', margin: '0 0 24px' }}>How do you want Ember to reach your game?</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {WORKFLOWS.map(([name, desc, tag, icon], i) => {
                const soon = tag === 'coming soon';
                return (
                  <div key={name} className="anim-up" style={{ ...card(false), animationDelay: `${i * 0.05}s` }}
                    onClick={() => (soon ? toast('Git cloning is coming soon — clone locally and connect the folder') : next())}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--accent-mid)' }}>{icon}</span>
                      <span className={`chip ${soon ? 'dim' : 'ok'}`} style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.07em' }}>{tag}</span>
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 5 }}>{name}</div>
                    <div style={{ fontSize: 11.5, lineHeight: 1.55, color: 'rgba(244,244,245,.45)' }}>{desc}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 style={{ fontSize: 26, fontWeight: 600, margin: '0 0 6px', letterSpacing: '-.02em' }}>Select your engine</h2>
            <p style={{ fontSize: 13, color: 'rgba(244,244,245,.45)', margin: '0 0 24px' }}>Ember tunes its scanners and log parsers per engine.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
              {ENGINE_CARDS.map(([key, name, files, support, color], i) => (
                <div key={key} className="anim-up" style={{ ...card(engine === key), padding: 18, animationDelay: `${i * 0.05}s` }}
                  onClick={() => { setEngine(key); setTimeout(next, 250); }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 7 }}>{name}</div>
                  <div style={{ fontSize: 10.5, lineHeight: 1.6, color: 'rgba(244,244,245,.4)', fontFamily: 'var(--font-mono)' }}>{files}</div>
                  <div style={{ marginTop: 10, fontSize: 9.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color }}>{support}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2 style={{ fontSize: 26, fontWeight: 600, margin: '0 0 6px', letterSpacing: '-.02em' }}>Connect your project</h2>
            <p style={{ fontSize: 13, color: 'rgba(244,244,245,.45)', margin: '0 0 24px' }}>Point Ember at your local project folder.</p>
            <div style={{ background: 'var(--bg-raise)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 14, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <input className="input mono" style={{ flex: 1 }} placeholder="C:/Projects/my-game or /Users/you/game" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pickFolder()} />
                <button className="btn btn-white" disabled={busy} onClick={pickFolder}>{isDesktop ? 'Choose folder' : 'Detect'}</button>
              </div>
              <div className="micro-mono" style={{ fontSize: 10.5, color: 'rgba(244,244,245,.3)' }}>
                {isDesktop ? 'Native folder picker + real engine detection' : 'Browser preview — type a path reachable by this machine; the desktop shell adds the native picker'}
              </div>
              {scanInfo?.detection && (
                <div className="anim-up" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                  <div className="card" style={{ padding: 14 }}><div style={{ fontSize: 22, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{scanInfo.detection.engine}</div><div style={{ fontSize: 10.5, color: 'rgba(244,244,245,.45)' }}>engine detected</div></div>
                  <div className="card" style={{ padding: 14 }}><div style={{ fontSize: 22, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{scanInfo.detection.confidence}</div><div style={{ fontSize: 10.5, color: 'rgba(244,244,245,.45)' }}>confidence</div></div>
                  <div className="card" style={{ padding: 14 }}><div style={{ fontSize: 22, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--ok)' }}>OK</div><div style={{ fontSize: 10.5, color: 'rgba(244,244,245,.45)' }}>read access</div></div>
                </div>
              )}
              {scanInfo?.detection?.evidence && (
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'rgba(244,244,245,.45)', lineHeight: 1.7 }}>
                  {scanInfo.detection.evidence.map((e) => <div key={e}>· {e}</div>)}
                </div>
              )}
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h2 style={{ fontSize: 26, fontWeight: 600, margin: '0 0 6px', letterSpacing: '-.02em' }}>Create ember.config.json</h2>
            <p style={{ fontSize: 13, color: 'rgba(244,244,245,.45)', margin: '0 0 24px' }}>This file drives every scan, check and report.</p>
            <div className="code" style={{ maxHeight: 280, overflow: 'auto' }}>{previewConfig}</div>
            <div style={{ display: 'flex', gap: 12, marginTop: 16, alignItems: 'center' }}>
              <button className="btn btn-white" disabled={busy} onClick={genConfig}>{configDone ? 'Regenerate' : 'Generate config'}</button>
              {configDone && <span style={{ fontSize: 12, color: 'var(--ok)', fontFamily: 'var(--font-mono)' }}>✓ config valid · saved to project root</span>}
            </div>
          </>
        )}

        {step === 6 && (
          <>
            <h2 style={{ fontSize: 26, fontWeight: 600, margin: '0 0 6px', letterSpacing: '-.02em' }}>Ember Agent check</h2>
            <p style={{ fontSize: 13, color: 'rgba(244,244,245,.45)', margin: '0 0 24px' }}>The agent runs scans and commands on your machine.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {(doctorRes?.checks ?? [
                { name: 'Ember CLI', status: 'warn', detail: 'not checked yet — run ember doctor' },
                { name: 'Config status', status: configDone ? 'ok' : 'warn', detail: configDone ? 'valid' : 'not created' }
              ]).slice(0, 9).map((c, i) => (
                <div key={c.name + i} className="anim-up" style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, padding: '14px 18px', animationDelay: `${i * 0.05}s` }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: { ok: 'var(--ok)', warn: 'var(--warn)', fail: 'var(--err)' }[c.status] ?? 'var(--warn)', flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 13 }}>{c.name}</div>
                  <div style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'rgba(244,244,245,.5)', maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.detail}</div>
                </div>
              ))}
            </div>
            <button className="btn btn-ghost" style={{ marginTop: 16 }} disabled={busy} onClick={runDoctor}>{busy ? 'Running…' : 'Run ember doctor'}</button>
          </>
        )}

        {step === 7 && (
          <>
            <h2 style={{ fontSize: 26, fontWeight: 600, margin: '0 0 6px', letterSpacing: '-.02em' }}>First scan</h2>
            <p style={{ fontSize: 13, color: 'rgba(244,244,245,.45)', margin: '0 0 24px' }}>
              {firstScan ? 'Ember just walked your project. Here is what it found.' : 'Run a real scan of the connected folder.'}
            </p>
            {firstScan ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                {[
                  [firstScan.filesScanned, 'files scanned', 'var(--ink)'],
                  [firstScan.sourceFileCount, 'source files', 'var(--ink)'],
                  [firstScan.engineDetection.engine, 'engine confirmed', 'var(--info)'],
                  [firstScan.dirsVisited, 'folders visited', 'var(--ink)'],
                  [Object.keys(firstScan.byExtension).length, 'file types', 'var(--warn)'],
                  [firstScan.truncated ? 'yes' : 'no', 'scan truncated', firstScan.truncated ? 'var(--warn)' : 'var(--ok)']
                ].map(([value, label, color], i) => (
                  <div key={label} className="card anim-up" style={{ padding: 16, animationDelay: `${i * 0.06}s` }}>
                    <div style={{ fontSize: 24, fontWeight: 600, fontFamily: 'var(--font-mono)', color }}>{value}</div>
                    <div style={{ fontSize: 10.5, color: 'rgba(244,244,245,.45)', marginTop: 4 }}>{label}</div>
                  </div>
                ))}
              </div>
            ) : (
              <button className="btn btn-white" disabled={busy || !scanInfo?.dir} onClick={runFirstScan}>
                {busy ? 'Scanning…' : scanInfo?.dir ? 'Run first scan' : 'Connect a folder first (step 4)'}
              </button>
            )}
          </>
        )}

        {step === 8 && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <img src={logo} alt="" style={{ width: 72, filter: 'drop-shadow(0 0 20px rgba(255,90,20,.45))' }} />
            <h2 style={{ fontSize: 30, fontWeight: 600, margin: '16px 0 26px', letterSpacing: '-.02em' }}>You're ready</h2>
            <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 9, textAlign: 'left', marginBottom: 30 }}>
              {finishList.map(([label, ok], i) => (
                <div key={label} className="anim-up" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'rgba(244,244,245,.7)', animationDelay: `${i * 0.08}s` }}>
                  <span style={{ color: ok ? 'var(--ok)' : 'var(--warn)', fontFamily: 'var(--font-mono)' }}>{ok ? '✓' : '·'}</span>{label}
                </div>
              ))}
            </div>
            <div><button className="btn btn-white" style={{ padding: '13px 32px' }} onClick={finish}>Open Command Center</button></div>
          </div>
        )}
      </div>

      {step > 1 && step < 8 && (
        <div style={{ width: 720, maxWidth: '100%', display: 'flex', justifyContent: 'space-between', marginTop: 26 }}>
          <button className="btn btn-ghost btn-sm" onClick={back}>Back</button>
          <button className="btn btn-white btn-sm" style={{ padding: '10px 26px' }} onClick={next}>Continue</button>
        </div>
      )}
    </div>
  );
}
