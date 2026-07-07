/**
 * Smoke tests for the Ember Agent core, using a synthetic Unity-like
 * fixture project generated on the fly. Run: npm test --workspace @ember/agent
 */
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateConfig, loadConfig, scanProject, analyzeCode, analyzeLogs, runProfile, buildReport, reportToMarkdown, detectEngine } from '../src/index.js';

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

// --- analyze: must find the planted patterns ---
const analysis = analyzeCode(reloaded, cfgRoot, { scan });
const ruleIds = new Set(analysis.findings.map((f) => f.ruleId));
assert.ok(ruleIds.has('unity-empty-catch') || ruleIds.has('js-empty-catch'), 'finds empty catch');
assert.ok(ruleIds.has('cs-async-void'), 'finds async void');
assert.ok(ruleIds.has('unity-getcomponent-update'), 'finds GetComponent in Update');

// --- logs: must find the planted NullReferenceException, deduped with occurrences ---
const logsRes = analyzeLogs(reloaded, cfgRoot);
assert.equal(logsRes.logsAnalyzed, 1);
const nre = logsRes.signals.find((s) => s.label.includes('Null reference'));
assert.ok(nre, 'finds NullReferenceException in logs');
assert.equal(nre.occurrences, 2);

// --- run profile: smoke completes, build blocked (no buildCommand) ---
const run = await runProfile(reloaded, cfgRoot, 'full', {});
assert.ok(run.checksPassed >= 2, 'agent checks pass');
assert.ok(run.steps.some((s) => s.type === 'blocked' && /buildCommand/.test(s.message)), 'missing build command reported as blocked, not faked');

// --- report ---
const report = buildReport({ config: reloaded, root: cfgRoot, scan, analyze: analysis, logs: logsRes, run });
assert.ok(report.metrics.bugsFound > 0);
assert.ok(report.metrics.filesScanned === scan.filesScanned);
assert.ok(report.bugs.every((b) => b.evidence), 'every bug carries evidence');
const md = reportToMarkdown(report);
assert.ok(md.includes('# Ember QA Report'));
assert.ok(md.includes('Null reference'));

rmSync(root, { recursive: true, force: true });
console.log('✓ agent tests passed');
