#!/usr/bin/env node
/**
 * Ember Agent CLI — the installable local QA agent.
 *
 *   ember init                      create ember.config.json (auto-detects engine)
 *   ember scan                      inventory project files + detect engine
 *   ember analyze                   static code analysis (real findings only)
 *   ember run [--profile smoke]     execute a test profile (checks + configured commands)
 *   ember report [--format json|md] build a QA report from a fresh run
 *   ember config validate           validate ember.config.json
 *   ember doctor                    diagnose environment + configuration
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadConfig, generateConfig, validateConfig,
  scanProject, analyzeCode, analyzeLogs, runProfile,
  buildReport, reportToMarkdown, doctor,
  backendFromConfig, LocalStore,
  aiConfigured, aiStatus, summarizeReport
} from '../src/index.js';
import { validateProjectRoot } from '@ember/shared/project-validator';
import { c, log, sevColor, humanBytes } from '../src/util.js';

const argv = process.argv.slice(2);
const command = argv[0];
const sub = argv[1];

function flag(name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

function requireConfig() {
  const loaded = loadConfig();
  if (!loaded.config) {
    log(`${c.red('✗')} ${loaded.errors.join('\n  ')}`);
    process.exit(1);
  }
  for (const w of loaded.warnings) log(`${c.yellow('!')} ${w}`);

  // A failed validation means NO scan, NO analysis, NO report — ever.
  // An existing ember.config.json counts as the user's explicit confirmation
  // for weakly-recognized custom projects.
  const validation = validateProjectRoot(loaded.root, { confirmedCustom: true });
  if (!validation.valid) {
    log(`${c.red('✗')} This folder does not appear to contain a supported game or code project.`);
    for (const e of validation.errors) log(`  ${c.red('·')} ${e}`);
    log(`  ${c.gray('Fix the project path in ember.config.json (gamePath) or re-run `ember init` in the real project root.')}`);
    process.exit(1);
  }
  loaded.validation = validation;
  return loaded;
}

function header(title) {
  log('');
  log(`${c.orange('◆')} ${c.bold(`EMBER ${title}`)}`);
  log(c.gray('─'.repeat(60)));
}

async function maybeSync(fn) {
  const { config } = loadConfig();
  const client = backendFromConfig(config);
  if (!client) return;
  try {
    await fn(client, config);
    log(`${c.green('✓')} synced to backend ${client.baseUrl}`);
  } catch (e) {
    log(`${c.yellow('!')} backend sync skipped: ${e.message}`);
  }
}

const commands = {
  async init() {
    header('INIT');
    const engine = flag('engine');
    const name = flag('name');
    const force = argv.includes('--force');
    const res = generateConfig(process.cwd(), { engine: engine ?? undefined, projectName: name ?? undefined, write: true, force });
    log(`Engine detection: ${c.bold(res.detection.engine)} (${res.detection.confidence})`);
    for (const e of res.detection.evidence) log(`  ${c.gray('·')} ${e}`);
    if (res.error) {
      log(`${c.yellow('!')} ${res.error}`);
      process.exit(1);
    }
    log(`${c.green('✓')} wrote ${res.path}`);
    log('');
    log('Next steps:');
    log(`  1. Edit ${c.bold('ember.config.json')} — set logsPath, buildCommand, testCommand`);
    log(`  2. ${c.bold('ember scan')}     — inventory your project`);
    log(`  3. ${c.bold('ember analyze')}  — find risky code`);
    log(`  4. ${c.bold('ember run --profile smoke')} — full smoke pass`);
  },

  async scan() {
    header('SCAN');
    const { config, root } = requireConfig();
    const scan = scanProject(config, root);
    log(`Root: ${root}`);
    log(`Engine: configured ${c.bold(config.engine)} · detected ${scan.engineDetection.engine} (${scan.engineDetection.confidence})`);
    log(`Files scanned: ${c.bold(scan.filesScanned)} (${humanBytes(scan.totalBytes)}) · source files: ${c.bold(scan.sourceFileCount)}${scan.truncated ? c.yellow(' · truncated at maxFiles') : ''}`);
    log('');
    log('Top extensions:');
    Object.entries(scan.byExtension).slice(0, 10).forEach(([ext, n]) => log(`  ${ext.padEnd(10)} ${n}`));
    if (scan.largeFiles.length) {
      log('');
      log('Largest files:');
      scan.largeFiles.slice(0, 5).forEach((f) => log(`  ${humanBytes(f.size).padEnd(9)} ${f.path}`));
    }
    if (flag('json')) writeOut('ember-scan.json', scan);
    await maybeSync(async (client) => {
      await client.ensureProject(config, root);
      await client.pushScan(sanitizeScan(scan));
    });
  },

  async analyze() {
    header('ANALYZE');
    const { config, root } = requireConfig();
    const analysis = analyzeCode(config, root);
    log(`Analyzed ${c.bold(analysis.filesAnalyzed)} files, ${analysis.linesAnalyzed} lines in ${(analysis.durationMs / 1000).toFixed(1)}s`);
    const sev = analysis.bySeverity;
    log(`Findings: ${c.red(sev.critical + ' critical')} · ${c.orange(sev.high + ' high')} · ${c.yellow(sev.medium + ' medium')} · ${c.gray(sev.low + ' low')}`);
    log('');
    const max = Number(flag('limit', 25));
    for (const f of analysis.findings.slice(0, max)) {
      log(`${sevColor(f.severity)(`[${f.severity.toUpperCase()}]`)} ${f.message}`);
      log(`  ${c.cyan(`${f.file}:${f.line}`)} ${c.gray(f.evidence.slice(0, 100))}`);
      if (f.suggest) log(`  ${c.gray('fix →')} ${f.suggest}`);
    }
    if (analysis.findings.length > max) log(c.gray(`… ${analysis.findings.length - max} more (use --limit N or --json)`));
    if (analysis.suggestedTests.length) {
      log('');
      log(c.bold('Suggested tests:'));
      analysis.suggestedTests.forEach((t) => log(`  ${c.orange('▸')} ${t.check} — ${t.reason}`));
    }
    if (flag('json')) writeOut('ember-analysis.json', stripScanFiles(analysis));
    await maybeSync(async (client) => {
      await client.ensureProject(config, root);
      await client.pushAnalysis(stripScanFiles(analysis));
    });
  },

  async run() {
    header('RUN');
    const { config, root } = requireConfig();
    const profile = flag('profile', 'smoke');
    const run = await runProfile(config, root, String(profile), {
      onStep(step) {
        if (step.type === 'output') return process.stdout.write(c.gray(step.message));
        const icon = { start: c.orange('◆'), running: c.cyan('…'), done: c.green('✓'), failed: c.red('✗'), blocked: c.yellow('⊘'), error: c.red('✗'), finish: c.orange('◆') }[step.type] ?? '·';
        log(`${icon} ${step.check ? c.bold(`[${step.check}] `) : ''}${step.message}`);
      }
    });
    const store = new LocalStore(root);
    const runFile = store.saveRun(run);
    log(c.gray(`run saved → ${runFile}`));
    process.exitCode = run.status === 'failed' ? 1 : 0;
  },

  async report() {
    header('REPORT');
    const { config, root } = requireConfig();
    const format = String(flag('format', 'json')).toLowerCase();
    const profile = flag('profile');
    const store = new LocalStore(root);

    log('Collecting fresh signals (scan + analyze + logs' + (profile ? ` + profile ${profile}` : '') + ')…');
    const scan = scanProject(config, root);
    const analysis = analyzeCode(config, root, { scan });
    const logsRes = analyzeLogs(config, root);
    const run = profile ? await runProfile(config, root, String(profile), { onStep: (s) => s.type !== 'output' && log(c.gray(`  ${s.message}`)) }) : null;

    const report = buildReport({ config, root, scan, analyze: analysis, logs: logsRes, run });

    // Regression comparison against previous stored report
    const previous = store.latestReport();
    if (previous) {
      const diff = store.compareReports(previous, report);
      report.regression = {
        comparedTo: previous.id,
        fixed: diff.fixed.map((b) => b.title),
        stillPresent: diff.stillPresent.length,
        new: diff.new.map((b) => b.title)
      };
      log(`Regression vs ${previous.id}: ${c.green(diff.fixed.length + ' fixed')}, ${diff.stillPresent.length} still present, ${c.orange(diff.new.length + ' new')}`);
    }
    if (flag('ai')) {
      const provider = flag('ai-provider');
      if (!aiConfigured()) {
        log(`${c.yellow('!')} --ai requested but no AI provider is configured (ANTHROPIC_API_KEY / OPENAI_API_KEY) — skipping AI summary`);
      } else {
        const status = aiStatus(provider);
        log(`Requesting AI executive summary (${status.label})…`);
        const ai = await summarizeReport(report, { provider });
        if (ai.ok) {
          report.aiExecutiveSummary = ai.text;
          report.aiProvider = ai.provider;
        } else log(`${c.yellow('!')} AI summary skipped: ${ai.error}`);
      }
    }
    store.saveReport(report);

    if (format === 'md' || format === 'markdown') {
      const file = join(process.cwd(), `ember-report-${Date.now()}.md`);
      writeFileSync(file, reportToMarkdown(report));
      log(`${c.green('✓')} Markdown report → ${file}`);
    } else {
      const file = join(process.cwd(), `ember-report-${Date.now()}.json`);
      writeFileSync(file, JSON.stringify(report, null, 2));
      log(`${c.green('✓')} JSON report → ${file}`);
    }
    log('');
    log(c.bold('Summary: ') + report.executiveSummary);
    await maybeSync(async (client) => {
      await client.ensureProject(config, root);
      await client.pushReport(report);
    });
  },

  async config() {
    if (sub !== 'validate') return usage(`Unknown subcommand "config ${sub ?? ''}" — did you mean: ember config validate`);
    header('CONFIG VALIDATE');
    const loaded = loadConfig();
    if (!loaded.path) {
      log(`${c.red('✗')} ${loaded.errors[0]}`);
      process.exit(1);
    }
    log(`Config: ${loaded.path}`);
    const raw = loaded.config ?? {};
    const { valid, errors, warnings } = loaded.config ? validateConfig(raw) : { valid: false, errors: loaded.errors, warnings: loaded.warnings };
    errors.forEach((e) => log(`${c.red('✗')} ${e}`));
    warnings.forEach((w) => log(`${c.yellow('!')} ${w}`));
    if (valid) log(`${c.green('✓')} ember.config.json is valid`);
    process.exit(valid ? 0 : 1);
  },

  async doctor() {
    header('DOCTOR');
    const result = await doctor();
    for (const chk of result.checks) {
      const icon = { ok: c.green('✓'), warn: c.yellow('!'), fail: c.red('✗') }[chk.status];
      log(`${icon} ${chk.name.padEnd(22)} ${chk.detail}`);
      if (chk.remedy) log(`    ${c.gray('→ ' + chk.remedy)}`);
    }
    log('');
    log(result.healthy ? c.green(`Healthy — ${result.warned} warning(s)`) : c.red(`${result.failed} check(s) failing`));
    process.exit(result.healthy ? 0 : 1);
  }
};

function sanitizeScan(scan) {
  // Don't upload every file path — inventory stats are enough for the backend.
  const { sourceFiles, ...rest } = scan;
  return rest;
}

function stripScanFiles(analysis) {
  return { ...analysis, scan: sanitizeScan(analysis.scan) };
}

function writeOut(name, data) {
  const file = join(process.cwd(), name);
  writeFileSync(file, JSON.stringify(data, null, 2));
  log(c.gray(`json → ${file}`));
}

function usage(err) {
  if (err) log(`${c.red('✗')} ${err}\n`);
  log(`${c.orange('◆')} ${c.bold('Ember Agent')} — autonomous QA for game projects

Usage:
  ember init [--engine unity|unreal|godot|web|custom] [--name "My Game"] [--force]
  ember scan [--json]
  ember analyze [--limit N] [--json]
  ember run [--profile smoke]
  ember report [--format json|md] [--profile smoke] [--ai] [--ai-provider claude|openai]
  ember config validate
  ember doctor

Ember only reports real signals: files it scanned, patterns it matched,
logs it parsed and commands it executed. Anything it cannot do yet is
reported as blocked with the exact configuration or integration missing.

Docs: docs/cli.md · Config reference: docs/config.md`);
  process.exit(err ? 1 : 0);
}

const handler = commands[command];
if (!handler) usage(command ? `Unknown command "${command}"` : null);
else {
  handler().catch((e) => {
    log(`${c.red('✗')} ${e.message}`);
    process.exit(1);
  });
}
