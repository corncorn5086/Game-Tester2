import { useEffect, useRef, useState } from 'react';
import {
  Download, Terminal, FileJson, MonitorSmartphone, Server, Workflow as WorkflowIcon,
  Upload, SlidersHorizontal, Flame, Bug, FileText, CheckCheck, AppWindow, Apple, Monitor
} from 'lucide-react';
import { ENGINES } from '@ember/shared/engines';
import { PLANS } from '@ember/shared/plans';
import logo from '../assets/ember-logo.png';

const RELEASES_URL = 'https://github.com/corncorn5086/Game-Tester2/releases';
const REPO_URL = 'https://github.com/corncorn5086/Game-Tester2';

/* ---------- HOW EMBER CONNECTS ---------- */
const CONNECT_STEPS = [
  {
    icon: FileJson,
    title: 'Drop in a config file',
    body: 'One ember.config.json at your project root tells Ember your engine, source folders, log paths and the commands that build, test and launch your game.',
    code: `{
  "projectName": "My Game",
  "engine": "unity",
  "logsPath": "Logs",
  "buildCommand": "…",
  "testCommand": "…"
}`
  },
  {
    icon: Terminal,
    title: 'Run the local agent',
    body: 'Ember Agent is a real CLI that works fully offline. It scans files, analyzes code, parses logs and executes your configured commands — reporting only what it actually observed.',
    code: `$ ember init      # detects your engine
$ ember scan
$ ember analyze
$ ember run --profile smoke
$ ember report --format md`
  },
  {
    icon: MonitorSmartphone,
    title: 'Pilot from Ember Desktop',
    body: 'The desktop app is mission control: connect projects, build test plans, watch live runs, triage bugs and export reports — every value comes from a real scan, run or log, with clear connected / not-connected states.',
    code: null
  },
  {
    icon: Server,
    title: 'Sync to the Ember backend',
    body: 'Optionally push scans, runs and reports to the Ember API so your team shares one triage board, usage metrics and report history.',
    code: null
  },
  {
    icon: WorkflowIcon,
    title: 'Wire into CI/CD',
    body: 'Run ember in your pipeline and fail builds on critical findings. GitHub Action and dedicated CI recipes are on the roadmap.',
    code: `# ci.yml (concept)
- run: ember run --profile smoke
- run: ember report --format json`
  },
  {
    icon: Flame,
    title: 'Go deeper with SDKs',
    body: 'Engine SDKs (Unity package, Unreal plugin, Godot addon, JS/TS runner) will unlock in-game checks: input driving, save/load probes, collision sweeps and scripted scenarios.',
    code: null
  }
];

export function Connect() {
  return (
    <section id="connect" className="dark-section">
      <div className="connect">
        <div className="kicker" data-rv>05 — INTEGRATION</div>
        <h2 className="section-title" data-rv style={{ maxWidth: 820 }}>
          How Ember connects to your game.
        </h2>
        <div className="connect-steps">
          {CONNECT_STEPS.map((s, i) => (
            <div key={s.title} className="connect-card" data-rv>
              <div className="num">STEP 0{i + 1}</div>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <s.icon size={19} color="#ff9d4d" /> {s.title}
              </h3>
              <p>{s.body}</p>
              {s.code && <div className="code-block">{s.code}</div>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- ENGINES ---------- */
export function Engines() {
  const keys = Object.keys(ENGINES);
  const [active, setActive] = useState('unity');
  const engine = ENGINES[active];
  return (
    <section id="engines" className="dark-section">
      <div className="engines">
        <div className="kicker" data-rv>06 — ENGINES</div>
        <h2 className="section-title" data-rv style={{ maxWidth: 900 }}>
          Unity, Unreal, Godot, web —<br />or your own engine.
        </h2>
        <div className="engine-tabs" data-rv>
          {keys.map((k) => (
            <button key={k} className={`engine-tab ${active === k ? 'active' : ''}`} onClick={() => setActive(k)}>
              {ENGINES[k].label}
            </button>
          ))}
        </div>
        <div className="engine-panel" data-rv key={active}>
          <div>
            <h4>Where Ember plugs in</h4>
            <ul>
              <li>Logs: {engine.logs.hint}</li>
              <li>Build: <code style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{engine.commands.build}</code></li>
              <li>Tests: <code style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{engine.commands.test}</code></li>
              <li>Launch: <code style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{engine.commands.launch}</code></li>
            </ul>
          </div>
          <div>
            <h4>What Ember analyzes & what's next</h4>
            <ul>
              <li>Sources: {engine.analyze.sourcePaths.join(', ')} ({engine.analyze.includeExtensions.join(' ')})</li>
              <li>{engine.logs.errorPatterns.length} built-in crash/error patterns for {engine.label} logs</li>
              {engine.futureIntegrations.map((f) => (
                <li key={f}>Roadmap: {f}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- WORKFLOW ---------- */
const STEPS = [
  [Upload, 'Connect your project', 'Point Ember at a local folder, repository or build — ember init detects your engine and writes the config.'],
  [SlidersHorizontal, 'Configure test plans', 'Pick checks — scan, analysis, logs, build, tests — plus custom commands and rules for your game.'],
  [Flame, 'Ignite the run', 'Ember executes every runnable check and streams each step, command and log line as it happens.'],
  [Bug, 'Detect & reproduce', 'Real signals become bugs with evidence, repro steps, severity, category and reproducibility confidence.'],
  [FileText, 'Generate the report', 'A professional QA report: executive summary, severity breakdown, crash risk, regression risks, suggested fixes.'],
  [CheckCheck, 'Fix & verify', 'Re-run after fixes — Ember diffs reports to confirm fixed bugs stay fixed and flags anything new.']
];

export function Workflow() {
  const ref = useRef(null);
  useEffect(() => {
    const rows = ref.current?.querySelectorAll('.step-row') ?? [];
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('lit')),
      { threshold: 0.4 }
    );
    rows.forEach((r) => obs.observe(r));
    return () => obs.disconnect();
  }, []);
  return (
    <section className="dark-section">
      <div className="workflow" ref={ref}>
        <div className="kicker" data-rv>07 — IGNITION SEQUENCE</div>
        <h2 className="section-title" data-rv>Six steps from build to confident release.</h2>
        <div style={{ marginTop: 54 }}>
          {STEPS.map(([Icon, title, body], i) => (
            <div key={title} className="step-row" data-rv>
              <div className="step-num">0{i + 1}</div>
              <div>
                <div className="head">
                  <Icon size={22} />
                  <h3>{title}</h3>
                </div>
                <p>{body}</p>
              </div>
              <div className="step-bar" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- DOWNLOAD ---------- */
export function DownloadSection() {
  return (
    <section id="download" className="dark-section">
      <div className="download">
        <div className="kicker" data-rv>08 — DOWNLOAD EMBER</div>
        <h2 className="section-title" data-rv>Put an agent on the team.</h2>
        <p data-rv style={{ marginTop: 18, color: 'var(--ink-dim)', fontSize: 17 }}>
          Ember Desktop for mission control, Ember Agent (CLI) for your terminal and CI.
        </p>
        <div className="dl-grid">
          {[
            [Monitor, 'Windows', 'Ember Desktop · .exe installer', RELEASES_URL],
            [Apple, 'macOS', 'Ember Desktop · universal .dmg', RELEASES_URL],
            [AppWindow, 'Linux', 'Ember Desktop · .AppImage / .deb', RELEASES_URL],
            [Terminal, 'Install CLI', 'Ember Agent · runs anywhere Node 20+ does', '#cli']
          ].map(([Icon, title, sub, href]) => (
            <a key={title} className="dl-card" data-rv href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
              <div className="icon">
                <Icon size={24} />
              </div>
              <h3>{title}</h3>
              <p>{sub}</p>
              <span className="btn btn-ghost btn-sm">
                <Download size={14} /> {title === 'Install CLI' ? 'Instructions' : 'Download'}
              </span>
            </a>
          ))}
        </div>
        <p className="dl-note" data-rv>
          Desktop binaries are published on GitHub Releases as they are built. The CLI works today:
        </p>
        <div id="cli" className="code-block dl-cli" data-rv>
          <span className="cmt"># Ember Agent — real, local, offline-first</span>{'\n'}
          git clone {REPO_URL}{'\n'}
          cd Game-Tester2 && npm install{'\n'}
          npm link --workspace @ember/agent   <span className="cmt"># adds `ember` to your PATH</span>{'\n'}
          {'\n'}
          <span className="cmt"># inside your game project</span>{'\n'}
          <span className="hl">ember init</span>{'\n'}
          <span className="hl">ember run --profile smoke</span>{'\n'}
          <span className="hl">ember report --format md</span>
        </div>
      </div>
    </section>
  );
}

/* ---------- PRICING ---------- */
export function Pricing() {
  return (
    <section id="pricing" className="dark-section">
      <div className="pricing">
        <div className="kicker" data-rv>09 — PRICING</div>
        <h2 className="section-title" data-rv>Start free. Scale when it burns.</h2>
        <div className="plans">
          {PLANS.map((p) => (
            <div key={p.id} className={`plan ${p.highlighted ? 'hl' : ''}`} data-rv>
              {p.highlighted && <span className="badge-pop">MOST POPULAR</span>}
              <div className="name">{p.name}</div>
              <div className="price">
                {p.price === null ? 'Custom' : p.price === 0 ? 'Free' : `$${p.price}`}
                {p.price ? <small> / {p.period}</small> : null}
              </div>
              <div className="tagline">{p.tagline}</div>
              <ul>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <a href={p.id === 'enterprise' ? '#enterprise' : '#download'} className={`btn ${p.highlighted ? 'btn-primary' : 'btn-ghost'} btn-sm`}>
                {p.id === 'enterprise' ? 'Talk to us' : p.price === 0 ? 'Get started' : `Choose ${p.name}`}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- ENTERPRISE ---------- */
export function Enterprise() {
  return (
    <section id="enterprise" className="dark-section">
      <div className="enterprise">
        <div className="ent-card" data-rv>
          <div>
            <div className="kicker">10 — ENTERPRISE</div>
            <h2 className="section-title" style={{ fontSize: 'clamp(30px,3.6vw,52px)' }}>
              For studios that can't ship surprises.
            </h2>
            <p style={{ marginTop: 18, color: 'var(--ink-dim)', lineHeight: 1.65, maxWidth: 460 }}>
              Private deployment, security controls and custom engine integrations — with on-premise
              deployment so your code never leaves your infrastructure.
            </p>
            <a href="mailto:hello@ember.dev" className="btn btn-primary btn-sm" style={{ marginTop: 26 }}>
              Contact the team
            </a>
          </div>
          <ul>
            <li>Private / on-prem deployment of the Ember backend</li>
            <li>On-device analysis: the agent reads your code on your machines</li>
            <li>Secret masking in every log and report Ember touches</li>
            <li>Role-based permissions: Owner, Admin, Developer, QA, Viewer</li>
            <li>Custom engine profiles and analysis rules built with you</li>
            <li>Priority support with a named engineer</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ---------- CTA + FOOTER ---------- */
export function Cta() {
  const embers = Array.from({ length: 14 }, (_, i) => ({
    left: `${(i * 71 + 13) % 100}%`,
    size: 2 + ((i * 37) % 4),
    dur: 3 + ((i * 53) % 40) / 10,
    delay: ((i * 29) % 50) / 10
  }));
  return (
    <section id="cta" className="cta">
      <div className="cta-card" data-rv>
        <div className="cta-glow" />
        {embers.map((e, i) => (
          <span
            key={i}
            className="cta-ember"
            style={{ left: e.left, width: e.size, height: e.size, animationDuration: `${e.dur}s`, animationDelay: `${e.delay}s` }}
          />
        ))}
        <h2>
          Ship like you have
          <br />a 50-person QA team.
        </h2>
        <p>Free during the ignition beta. Mac · Windows · Linux · CLI.</p>
        <div className="cta-actions">
          <a href="#download" className="btn btn-primary">
            <Download size={19} /> Download Ember
          </a>
          <a href={REPO_URL} className="btn btn-ghost" target="_blank" rel="noreferrer">
            Star on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-grid">
        <div>
          <div className="brand">
            <img src={logo} alt="Ember" className="brand-logo" style={{ width: 22 }} />
            <span className="brand-name" style={{ fontSize: 15, letterSpacing: '0.3em' }}>EMBER</span>
          </div>
          <p className="footer-tag">The autonomous QA agent that burns every bug out of your game.</p>
        </div>
        <div style={{ display: 'flex', gap: 60 }}>
          <div className="footer-col">
            <span>Product</span>
            <a href="#features">Capabilities</a>
            <a href="#app">Ember Desktop</a>
            <a href="#download">Ember Agent (CLI)</a>
            <a href="#pricing">Pricing</a>
          </div>
          <div className="footer-col">
            <span>Integrate</span>
            <a href="#connect">How it connects</a>
            <a href="#engines">Engines</a>
            <a href={`${REPO_URL}/tree/main/docs`} target="_blank" rel="noreferrer">Documentation</a>
            <a href={`${REPO_URL}/tree/main/docs/cli.md`} target="_blank" rel="noreferrer">CLI reference</a>
          </div>
          <div className="footer-col">
            <span>Company</span>
            <a href="#enterprise">Enterprise</a>
            <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
            <a href="mailto:hello@ember.dev">Contact</a>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 EMBER LABS</span>
        <span>FORGED FOR GAME MAKERS</span>
      </div>
    </footer>
  );
}
