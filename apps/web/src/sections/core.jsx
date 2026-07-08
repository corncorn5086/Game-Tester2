import { useEffect, useState } from 'react';
import {
  Download, Play, Check, Gamepad2, Bug, ScanEye, Gauge, Code2, WandSparkles,
  Brain, Shuffle, GitCompare, Flame, FlaskConical, Package, Bot, FileText
} from 'lucide-react';
import { useTerminalFeed } from '../lib/hooks.js';
import logo from '../assets/ember-logo.png';

const RELEASES_URL = 'https://github.com/corncorn5086/Game-Tester2/releases';

/* ---------- NAV ---------- */
export function Nav({ solid }) {
  return (
    <nav className={`nav ${solid ? 'solid' : ''}`}>
      <a href="#top" className="brand">
        <img src={logo} alt="Ember" className="brand-logo" />
        <span className="brand-name">EMBER</span>
      </a>
      <div className="nav-links">
        <a href="#problem">Problem</a>
        <a href="#solution">Solution</a>
        <a href="#features">Capabilities</a>
        <a href="#app">App</a>
        <a href="#connect">Integration</a>
        <a href="#pricing">Pricing</a>
      </div>
      <a href="#download" className="btn btn-primary btn-sm">
        <img src={logo} alt="" className="btn-logo" /> Download
      </a>
    </nav>
  );
}

/* ---------- HERO ---------- */
export function Hero() {
  const [wordsIn, setWordsIn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWordsIn(true), 200);
    return () => clearTimeout(t);
  }, []);
  const words = ['Burn', 'every', 'bug', '\n', 'out', 'of', 'your'];
  return (
    <header id="top" className="hero">
      <div style={{ maxWidth: 880 }}>
        <div className="hero-badge" data-rv>
          <span className="pulse" />
          AUTONOMOUS QA · IGNITION BUILD
        </div>
        <h1>
          {words.map((w, i) =>
            w === '\n' ? (
              <br key={i} />
            ) : (
              <span key={i} className={`emword ${wordsIn ? 'in' : ''}`} style={{ transitionDelay: `${i * 90}ms`, marginRight: '0.22em' }}>
                {w}
              </span>
            )
          )}
          <span className={`emword flame-word ${wordsIn ? 'in' : ''}`} style={{ transitionDelay: `${words.length * 90}ms` }}>
            game.
          </span>
        </h1>
        <p className="hero-sub" data-rv>
          Ember is an autonomous QA agent that plugs into your game project — it scans your codebase, watches your
          logs, runs your build and test commands, and hands you a professional QA report with reproducible bugs
          and suggested fixes.
        </p>
        <div className="hero-ctas" data-rv>
          <a href="#download" className="btn btn-primary">
            <img src={logo} alt="" className="btn-logo btn-logo-lg" /> Download Ember
          </a>
          <a href="#app" className="btn btn-ghost">
            <Play size={16} /> See the desktop app
          </a>
        </div>
      </div>
      <div className="hero-scroll" data-rv>
        <div className="mouse">
          <span />
        </div>
        SCROLL TO IGNITE
      </div>
    </header>
  );
}

/* ---------- PROBLEM ---------- */
export function Problem() {
  const cards = [
    ['days', 'per regression pass', 'Every build eats human hours. Velocity burns out before launch.'],
    ['edge', 'cases hide in the dark', 'Rare state combinations crash where no human thinks to look.'],
    ['zero', 'QA budget for indies', 'Small teams ship and pray the community finds it first.']
  ];
  return (
    <section id="problem" className="problem">
      <div className="kicker" data-rv>01 — THE HEAT</div>
      <h2 className="section-title" data-rv style={{ maxWidth: 1000 }}>
        Manual QA melts under the pace games ship at today.
      </h2>
      <div className="problem-grid">
        {cards.map(([big, title, body]) => (
          <div key={big} className="problem-card" data-rv>
            <div className="big">{big}</div>
            <h3>{title}</h3>
            <p>{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- SOLUTION ---------- */
const FEED_LINES = [
  ['› ember scan — 1,284 files inventoried', '#ff9d4d'],
  ['› engine detected: unity (high confidence)', '#9a958f'],
  ['› analyzing Assets/Scripts — 214 sources', '#9a958f'],
  ['✗ HIGH · empty catch swallows SaveSystem errors', '#ff6a4d'],
  ['✗ CRASH · NullReferenceException ×12 in Player.log', '#ff6a4d'],
  ['→ bug opened · repro confidence: high', '#ffd27a'],
  ['› report ready — 7 issues · crash risk: high', '#ff9d4d']
];

export function Solution() {
  const visible = useTerminalFeed(FEED_LINES);
  return (
    <section id="solution" className="light flip-top">
      <div className="solution-grid">
        <div>
          <div className="kicker on-light" data-rv>02 — THE FORGE</div>
          <h2 data-rv>
            It reads.
            <br />
            It runs.
            <br />
            It writes the
            <br />
            <span className="accent-word">report.</span>
          </h2>
          <p className="solution-copy" data-rv>
            Ember connects to your repository, logs and build pipeline. It analyzes the code paths players will hit,
            mines your logs for crashes, executes the commands you configure and turns every real signal into a
            triaged, reproducible bug.
          </p>
          <div className="solution-points" data-rv>
            {['Every bug backed by file, line or log evidence', 'Issues classified by severity, category and regression risk', 'Blocked checks reported honestly — never simulated'].map((t) => (
              <div key={t} className="point">
                <span className="tick">
                  <Check size={15} />
                </span>
                {t}
              </div>
            ))}
          </div>
        </div>
        <div className="terminal" data-rv>
          <div className="terminal-bar">
            <span className="dot" style={{ background: '#ff5f57' }} />
            <span className="dot" style={{ background: '#febc2e' }} />
            <span className="dot" style={{ background: '#28c840' }} />
            <span className="label">ember run --profile smoke</span>
          </div>
          <div className="terminal-body">
            {FEED_LINES.slice(0, visible).map(([text, color], i) => (
              <div key={i} className="show" style={{ color }}>
                {text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- CAPABILITIES ---------- */
const FEATURES = [
  [Code2, 'Codebase analysis', 'Static analysis tuned for game code: risky patterns, missing error handling, save-system hazards.', 5],
  [Bug, 'Bug detection', 'Crash signals from logs, failed checks and code analysis become triaged bug reports.', 4],
  [FileText, 'Professional QA reports', 'Executive summary, severity breakdown, repro steps, JSON & Markdown export.', 3],
  [Gauge, 'Performance review', 'Per-frame hot paths, allocation traps and timing hazards flagged before they ship.', 3],
  [Gamepad2, 'Gameplay test automation', 'Test plans drive your configured build, test and launch commands today; input drivers next.', 4],
  [WandSparkles, 'Suggested fixes', 'Every finding carries a concrete remediation, ready to paste into a ticket.', 5],
  [Brain, 'Engine-aware', 'Unity, Unreal, Godot and web profiles: log formats, commands and integration points built in.', 4],
  [Shuffle, 'Log mining', 'Exceptions, assertions and fatal errors deduplicated with occurrence counts and context.', 4],
  [GitCompare, 'Regression tracking', 'Reports are compared run-over-run: fixed, still present, or new — verified, not assumed.', 4]
];

export function Features() {
  return (
    <section id="features" className="features">
      <div className="features-inner">
        <div className="kicker on-light" data-rv>03 — CAPABILITIES</div>
        <h2 className="section-title" data-rv style={{ maxWidth: 760 }}>
          A whole QA department, running in parallel.
        </h2>
        <div className="bento">
          {FEATURES.map(([Icon, title, body, span], i) => (
            <div key={title} className="feat" data-rv style={{ gridColumn: `span ${span}`, transitionDelay: `${(i % 3) * 0.05}s` }}>
              <div className="icon">
                <Icon size={22} />
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- APP PREVIEW (professional metrics, no stability score) ---------- */
export function AppPreview() {
  return (
    <section id="app" className="dark-section flip-top">
      <div className="app-preview">
        <div data-rv style={{ textAlign: 'center' }}>
          <div className="kicker">04 — MISSION CONTROL</div>
          <h2 className="section-title">
            Ember Desktop stays calm
            <br />
            while it sets fires.
          </h2>
        </div>
        <div className="app-frame" data-rv>
          <div className="app-window">
            <div className="app-titlebar">
              <span className="dot" style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57' }} />
              <span className="dot" style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e' }} />
              <span className="dot" style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840' }} />
              <span style={{ marginLeft: 14, fontSize: 12, color: '#7a7470', fontFamily: 'var(--font-mono)' }}>EMBER — Command Center</span>
            </div>
            <div className="app-body">
              <div className="app-side">
                {[
                  [Flame, 'Command Center', true],
                  [FlaskConical, 'Test Plans', false],
                  [Bug, 'Bug Reports', false],
                  [Package, 'Projects', false],
                  [Bot, 'Agent', false]
                ].map(([Icon, label, active]) => (
                  <div key={label} className={`item ${active ? 'active' : ''}`}>
                    <Icon size={16} /> {label}
                  </div>
                ))}
              </div>
              <div className="app-main">
                <div className="stat-grid">
                  <div className="stat">
                    <div className="label">Bugs found</div>
                    <div className="value" style={{ color: '#ff6a4d' }}>7</div>
                  </div>
                  <div className="stat">
                    <div className="label">Failed checks</div>
                    <div className="value" style={{ color: '#ff9d4d' }}>2</div>
                  </div>
                  <div className="stat">
                    <div className="label">Files scanned</div>
                    <div className="value">1,284</div>
                  </div>
                  <div className="stat">
                    <div className="label">Crash risk</div>
                    <div className="value" style={{ color: '#ffd27a' }}>high</div>
                  </div>
                </div>
                <div className="app-panels">
                  <div className="app-panel">
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#9a958f' }}>
                      <span>Issue severity breakdown</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: '#ff9d4d' }}>last run</span>
                    </div>
                    <svg viewBox="0 0 320 84" style={{ width: '100%', height: 84, marginTop: 12 }}>
                      {[
                        ['critical', 1, '#ff5f57'],
                        ['high', 3, '#ff9d6e'],
                        ['medium', 2, '#febc2e'],
                        ['low', 1, '#8b857f']
                      ].map(([label, n, color], i) => (
                        <g key={label}>
                          <rect x={i * 80 + 14} y={70 - n * 18} width={38} height={n * 18} rx={5} fill={color} opacity={0.85} />
                          <text x={i * 80 + 33} y={82} textAnchor="middle" fontSize={9} fill="#8b857f" fontFamily="JetBrains Mono">
                            {label}
                          </text>
                        </g>
                      ))}
                    </svg>
                  </div>
                  <div className="app-panel">
                    <div style={{ fontSize: 13, color: '#9a958f', marginBottom: 12 }}>Live bug feed</div>
                    {[
                      ['#ff5f57', 'Critical · NullReferenceException ×12 · Player.log'],
                      ['#ff9d6e', 'High · empty catch in SaveSystem.cs:41'],
                      ['#febc2e', 'Medium · setInterval game loop · main.ts:12']
                    ].map(([color, text]) => (
                      <div key={text} className="feed-line">
                        <span className="sev" style={{ background: color }} />
                        {text}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div data-rv style={{ textAlign: 'center', marginTop: 38 }}>
          <a href={RELEASES_URL} className="btn btn-primary btn-sm" target="_blank" rel="noreferrer">
            Get Ember Desktop <Download size={16} />
          </a>
        </div>
      </div>
    </section>
  );
}
