/**
 * Smoke tests for the Ember Agent core, using a synthetic Unity-like
 * fixture project generated on the fly. Run: npm test --workspace @ember/agent
 */
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aiStatus,
  generateConfig,
  loadConfig,
  scanProject,
  scanProjectAsync,
  summarizeReport,
  testAIConnection,
  analyzeCode,
  analyzeCodeAsync,
  analyzeLogs,
  runCommand,
  runProfile,
  buildReport,
  reportToMarkdown,
  detectEngine,
  LocalStore
} from '../src/index.js';

const root = mkdtempSync(join(tmpdir(), 'ember-fixture-'));

// --- synthetic Unity project with real bug-prone code ---
mkdirSync(join(root, 'Assets/Scripts'), { recursive: true });
mkdirSync(join(root, 'ProjectSettings'), { recursive: true });
mkdirSync(join(root, 'Logs'), { recursive: true });
writeFileSync(join(root, 'ProjectSettings/ProjectVersion.txt'), 'm_EditorVersion: 2022.3.10f1\n');
writeFileSync(join(root, 'Assets/Scripts/SaveSystem.cs'), `
using UnityEngine;
public class SaveSystem : MonoBehaviour {
  void Update() {
    var mgr = GameObject.Find("GameManager").GetComponent<GameManager>();
  }
  public void Load() {
    try { var data = PlayerPrefs.GetString("save"); } catch { }
  }
  async void SaveAsync() { /* fire and forget */ }
}
`);
const plantedSecret = 'sk-1234567890abcdefghijklmnop';
writeFileSync(join(root, 'Assets/Scripts/Secret.cs'), `public static class SecretFixture { const string apiKey = "${plantedSecret}"; }\n`);
writeFileSync(join(root, 'Logs/Player.log'), `
Initialize engine version: 2022.3.10f1
NullReferenceException: Object reference not set to an instance of an object
  at SaveSystem.Load () [0x00000]
NullReferenceException: Object reference not set to an instance of an object
  at SaveSystem.Load () [0x00000]
Shader error in 'Custom/Water': undeclared identifier
`);

// --- engine detection ---
const det = detectEngine(root);
assert.equal(det.engine, 'unity');
assert.equal(det.confidence, 'high');

// --- init/config ---
const gen = generateConfig(root, { write: true });
assert.equal(gen.written, true);
const { config, root: cfgRoot, errors } = loadConfig(root);
assert.deepEqual(errors, []);
assert.equal(config.engine, 'unity');

// point logs at the fixture logs folder
config.logsPath = 'Logs';
writeFileSync(join(root, 'ember.config.json'), JSON.stringify(config, null, 2));
const reloaded = loadConfig(root).config;

// --- scan ---
const scan = scanProject(reloaded, cfgRoot);
assert.ok(scan.filesScanned >= 3, 'scans fixture files');
assert.equal(scan.engineDetection.engine, 'unity');

// --- async scan: measured, relative progress with exact counters ---
const scanProgress = [];
const asyncScan = await scanProjectAsync(reloaded, cfgRoot, {
  batchSize: 1,
  onProgress: (event) => scanProgress.push(event)
});
assert.equal(asyncScan.filesScanned, scan.filesScanned, 'async scan inventories the same files');
assert.equal(asyncScan.sourceFileCount, scan.sourceFileCount, 'async scan identifies the same source files');
const scanFileEvent = scanProgress.find((event) => event.currentFile);
assert.ok(scanFileEvent, 'async scan reports a current relative file');
assert.ok(!scanFileEvent.currentFile.startsWith(cfgRoot), 'progress never exposes the current file as an absolute path');
assert.equal(typeof scanFileEvent.counts.filesProcessed, 'number');
assert.ok(scanProgress.some((event) => event.phase === 'scan' && event.stage === 'complete' && event.counts.filesProcessed === scan.filesScanned), 'scan completion reports the exact final count');

// --- analyze: must find the planted patterns ---
const analysis = analyzeCode(reloaded, cfgRoot, { scan });
const ruleIds = new Set(analysis.findings.map((f) => f.ruleId));
assert.ok(ruleIds.has('unity-empty-catch') || ruleIds.has('js-empty-catch'), 'finds empty catch');
assert.ok(ruleIds.has('cs-async-void'), 'finds async void');
assert.ok(ruleIds.has('unity-getcomponent-update'), 'finds GetComponent in Update');
const secretFinding = analysis.findings.find((finding) => finding.ruleId === 'hardcoded-secret');
assert.ok(secretFinding, 'finds the planted hardcoded secret');
assert.ok(secretFinding.evidence.includes('MASKED'), 'masks secret evidence before persistence');
assert.ok(!secretFinding.evidence.includes(plantedSecret), 'never stores the raw secret in evidence');

// --- async analysis: same findings plus live file/line telemetry ---
const analyzeProgress = [];
const asyncAnalysis = await analyzeCodeAsync(reloaded, cfgRoot, {
  scan: asyncScan,
  fileBatchSize: 1,
  lineBatchSize: 1,
  onProgress: (event) => analyzeProgress.push(event)
});
assert.deepEqual(new Set(asyncAnalysis.findings.map((finding) => finding.ruleId)), ruleIds, 'async analysis applies the same rules');
assert.equal(asyncAnalysis.linesAnalyzed, analysis.linesAnalyzed, 'async analysis measures the same line count');
const rulesEvent = analyzeProgress.find((event) => event.stage === 'rules');
assert.ok(rulesEvent?.currentFile, 'analysis progress identifies the current relative source file');
assert.equal(typeof rulesEvent.currentLine, 'number');
assert.equal(typeof rulesEvent.counts.findings, 'number');
assert.ok(analyzeProgress.some((event) => event.stage === 'complete' && event.counts.linesProcessed === analysis.linesAnalyzed), 'analysis completion reports exact final counters');

// --- direct async cancellation: aborts between real batches ---
const scanController = new AbortController();
await assert.rejects(
  scanProjectAsync(reloaded, cfgRoot, {
    batchSize: 1,
    signal: scanController.signal,
    onProgress: (event) => {
      if (event.currentFile) scanController.abort('Stop async scan');
    }
  }),
  (error) => error?.name === 'AbortError' && /Stop async scan/.test(error.message)
);

const analyzeController = new AbortController();
await assert.rejects(
  analyzeCodeAsync(reloaded, cfgRoot, {
    scan,
    signal: analyzeController.signal,
    lineBatchSize: 1,
    onProgress: (event) => {
      if (event.phase === 'analyze' && event.stage === 'rules') analyzeController.abort('Stop async analysis');
    }
  }),
  (error) => error?.name === 'AbortError' && /Stop async analysis/.test(error.message)
);

// --- logs: must find the planted NullReferenceException, deduped with occurrences ---
const logsRes = analyzeLogs(reloaded, cfgRoot);
assert.equal(logsRes.logsAnalyzed, 1);
const nre = logsRes.signals.find((s) => s.label.includes('Null reference'));
assert.ok(nre, 'finds NullReferenceException in logs');
assert.equal(nre.occurrences, 2);

// --- run profile: smoke completes, build blocked (no buildCommand) ---
const runEvents = [];
const run = await runProfile(reloaded, cfgRoot, 'full', { onStep: (event) => runEvents.push(event) });
assert.ok(run.checksPassed >= 2, 'agent checks pass');
assert.ok(run.steps.some((s) => s.type === 'blocked' && /buildCommand/.test(s.message)), 'missing build command reported as blocked, not faked');
const runProgress = runEvents.find((event) => event.type === 'progress' && event.currentFile);
assert.ok(runProgress, 'runProfile forwards real scan/analyze progress');
assert.ok(runProgress.phase === 'scan' || runProgress.phase === 'analyze');
assert.equal(typeof runProgress.counts.filesProcessed, 'number');
const logsTerminal = runEvents.find((event) => event.check === 'logs' && ['done', 'failed', 'blocked'].includes(event.type));
assert.equal(logsTerminal.data.logsAnalyzed, logsRes.logsAnalyzed, 'logs terminal event carries measured file count');
assert.equal(logsTerminal.data.linesRead, logsRes.linesRead, 'logs terminal event carries measured line count');
assert.equal(logsTerminal.data.signalCount, logsRes.signals.length, 'logs terminal event carries measured signal count');

// Regression comparison is honestly identified as deferred to report persistence.
reloaded.testProfiles.regressionTelemetry = { checks: ['regression'], commands: [] };
const regressionRun = await runProfile(reloaded, cfgRoot, 'regressionTelemetry');
const regressionStep = regressionRun.steps.find((event) => event.check === 'regression' && event.type === 'done');
assert.equal(regressionStep.data.comparison, 'deferred-to-report-persistence');
assert.match(regressionStep.message, /when this report is persisted/i);

// --- runProfile cancellation also interrupts an in-process scan ---
reloaded.testProfiles.cancelScan = { checks: ['scan'], commands: [] };
const profileScanController = new AbortController();
const cancelledScanRun = await runProfile(reloaded, cfgRoot, 'cancelScan', {
  signal: profileScanController.signal,
  onStep: (event) => {
    if (event.type === 'progress' && event.currentFile) profileScanController.abort('Stopped during scan');
  }
});
assert.equal(cancelledScanRun.status, 'cancelled');
assert.ok(cancelledScanRun.steps.some((event) => event.type === 'cancelled' && /Stopped during scan/.test(event.message)));

// --- cancellation: stop the real process tree and report cancelled, not failed ---
reloaded.launchCommand = `"${process.execPath}" -e "setTimeout(function () {}, 10000)"`;
reloaded.testProfiles.cancel = { checks: ['launch'], commands: [] };
const controller = new AbortController();
const cancelTimer = setTimeout(() => controller.abort('Stopped by test'), 150);
const cancelledRun = await runProfile(reloaded, cfgRoot, 'cancel', { signal: controller.signal });
clearTimeout(cancelTimer);
assert.equal(cancelledRun.status, 'cancelled');
assert.ok(cancelledRun.steps.some((s) => s.type === 'cancelled' && /Stopped by test/.test(s.message)), 'abort reason is preserved');
assert.equal(cancelledRun.checksFailed, 0, 'user cancellation is not reported as a failed check');

// AI provider keys stay available to Ember itself but never reach project commands.
const previousOpenAIKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = 'sk-proj-child-env-isolation-test-secret';
try {
  const isolated = await runCommand(
    `"${process.execPath}" -e "process.exit(process.env.OPENAI_API_KEY ? 9 : 0)"`,
    { cwd: cfgRoot }
  );
  assert.equal(isolated.exitCode, 0, 'project commands cannot read Ember AI credentials');
} finally {
  if (previousOpenAIKey == null) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousOpenAIKey;
}

// --- command strings and telemetry are masked before being stored ---
const commandSecret = 'commandSecretValue123456';
reloaded.testProfiles.masking = {
  checks: [],
  commands: [`"${process.execPath}" -e "process.exit(0)" -- "token=${commandSecret}"`]
};
const maskingEvents = [];
const maskingRun = await runProfile(reloaded, cfgRoot, 'masking', { onStep: (event) => maskingEvents.push(event) });
assert.ok(maskingRun.executions.length === 1, 'masking fixture executes one real command');
assert.ok(!JSON.stringify(maskingRun).includes(commandSecret), 'persisted run artifacts never include a command secret');
assert.ok(!JSON.stringify(maskingEvents).includes(commandSecret), 'live telemetry never includes a command secret');
assert.ok(maskingRun.executions[0].command.includes('MASKED'), 'stored command preserves useful masked context');

// --- report ---
const report = buildReport({ config: reloaded, root: cfgRoot, scan, analyze: analysis, logs: logsRes, run });
assert.ok(report.metrics.bugsFound > 0);
assert.ok(report.metrics.filesScanned === scan.filesScanned);
assert.ok(report.bugs.every((b) => b.evidence), 'every bug carries evidence');
const md = reportToMarkdown(report);
assert.ok(md.includes('# Ember QA Report'));
assert.ok(md.includes('Null reference'));

// --- real-AI transport contract: explicit credentials, Responses API and prompt masking ---
const aiKey = 'sk-proj-agent-test-secret-never-send-in-prompt';
const aiState = aiStatus('openai', {
  credentials: { openai: aiKey },
  verifiedProviders: ['openai']
});
assert.equal(aiState.enabled, true);
assert.ok(aiState.configured.includes('openai'));
assert.ok(aiState.verified.includes('openai'));
assert.equal(aiState.providers.find((provider) => provider.id === 'openai').source, 'supplied');

const originalFetch = globalThis.fetch;
const aiRequests = [];
let readinessReply = 'EMBER_OK';
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  aiRequests.push({ url, options, body });
  const text = body.input.includes('Connection check for Ember QA') ? readinessReply : 'EMBER_OK';
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: `resp_agent_test_${aiRequests.length}`,
      model: 'gpt-5.6-terra',
      output: [{ type: 'message', content: [{ type: 'output_text', text }] }]
    })
  };
};
try {
  const connected = await testAIConnection({ provider: 'openai', credentials: { openai: aiKey } });
  assert.equal(connected.ok, true);
  assert.equal(connected.requestId, 'resp_agent_test_1');
  assert.ok(connected.durationMs >= 0);
  assert.equal(aiRequests[0].body.input, 'Connection check for Ember QA. Reply with exactly: EMBER_OK');
  assert.equal(aiRequests[0].body.max_output_tokens, 16);
  assert.equal(aiRequests[0].body.reasoning.effort, 'none');

  const reportWithSecret = structuredClone(report);
  reportWithSecret.blockers.push({ code: 'fixture', message: `api_key: ${aiKey}` });
  const summary = await summarizeReport(reportWithSecret, { provider: 'openai', credentials: { openai: aiKey } });
  assert.equal(summary.ok, true);
  const summaryRequest = aiRequests[1];
  assert.equal(summaryRequest.url, 'https://api.openai.com/v1/responses');
  assert.equal(summaryRequest.body.store, false);
  assert.equal(summaryRequest.body.reasoning.effort, 'low');
  assert.ok(!summaryRequest.body.input.includes(aiKey), 'an exact credential is masked before prompt upload');
  assert.ok(summaryRequest.body.input.includes('MASKED'));

  readinessReply = 'EMBER_ALMOST_OK';
  const invalidConnection = await testAIConnection({ provider: 'openai', credentials: { openai: aiKey } });
  assert.equal(invalidConnection.ok, false, 'readiness requires the exact challenge response');
  assert.equal(invalidConnection.error, 'AI provider readiness response was invalid.');
  assert.equal(JSON.stringify(invalidConnection).includes(readinessReply), false, 'invalid provider output is discarded');
  readinessReply = 'EMBER_OK';

  const aborted = new AbortController();
  aborted.abort('test cancellation');
  const callsBeforeAbort = aiRequests.length;
  const cancelledAI = await testAIConnection({
    provider: 'openai',
    credentials: { openai: aiKey },
    signal: aborted.signal
  });
  assert.equal(cancelledAI.cancelled, true);
  assert.equal(aiRequests.length, callsBeforeAbort, 'an already-cancelled AI request never reaches the provider');
} finally {
  globalThis.fetch = originalFetch;
}

// --- local history: corrupt files stay enumerable instead of disappearing ---
const store = new LocalStore(root);
const persistedSecret = 'sk-proj-persisted-report-secret-value';
const reportToPersist = structuredClone(report);
reportToPersist.blockers.push({ code: 'secret-fixture', message: `api_key: ${persistedSecret}` });
const persistedReportFile = store.saveReport(reportToPersist);
assert.ok(!readFileSync(persistedReportFile, 'utf8').includes(persistedSecret), 'local report persistence masks secrets centrally');
writeFileSync(join(root, '.ember/reports/corrupt-report.json'), '{not valid json');
const storedReports = store.listReports();
assert.equal(storedReports.length, 2, 'enumerates every JSON report file');
assert.ok(storedReports.some((entry) => entry.id === report.id && !entry.kind), 'keeps valid report metadata');
const corruptStoredReport = storedReports.find((entry) => entry.kind === 'corrupt-report');
assert.equal(corruptStoredReport.id, 'corrupt-report');
assert.equal(corruptStoredReport.loadError.code, 'REPORT_INVALID');

rmSync(root, { recursive: true, force: true });
console.log('✓ agent tests passed');
