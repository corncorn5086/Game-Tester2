const assert = require('node:assert');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { createProjectService, publicError } = require('./project-service.cjs');

async function main() {
  const base = mkdtempSync(join(tmpdir(), 'ember-project-service-'));
  const game = join(base, 'Game');
  const empty = join(base, 'Empty');
  try {
    mkdirSync(join(game, 'Assets', 'Scripts'), { recursive: true });
    mkdirSync(join(game, 'ProjectSettings'), { recursive: true });
    mkdirSync(empty, { recursive: true });
    writeFileSync(join(game, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.1f1\n');
    writeFileSync(join(game, 'Assets', 'Scripts', 'Player.cs'), 'class Player { void Update() {} }\n');

    const service = createProjectService({
      dataDir: join(base, 'user-data'),
      loadAgent: () => import('@ember/agent'),
      loadChecks: () => import('@ember/shared/checks')
    });

    const candidate = await service.inspectProject(game);
    assert.equal(candidate.admissible, true);
    assert.equal(candidate.engine, 'unity');
    assert.equal(candidate.config.exists, false);
    assert.ok(candidate.capabilities.some((capability) => capability.id === 'scan' && capability.available));

    const emptyCandidate = await service.inspectProject(empty);
    assert.equal(emptyCandidate.admissible, false);
    assert.equal(emptyCandidate.issues[0].code, 'PROJECT_EMPTY');

    const added = await service.addProject({ path: game, name: 'Project Service Test' });
    assert.equal(added.created, true);
    assert.ok(existsSync(join(game, 'ember.config.json')));
    const duplicate = await service.addProject({ path: game });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.project.id, added.project.id);

    const read = await service.readConfig(added.project.id);
    const edited = JSON.parse(read.text);
    edited.projectName = 'Renamed Project';
    edited.backend = {
      ...edited.backend,
      url: 'https://ember.example',
      token: 'ember-session-token'
    };
    const saved = await service.saveConfig({
      projectId: added.project.id,
      text: JSON.stringify(edited, null, 2),
      expectedRevision: read.revision
    });
    assert.equal(saved.project.name, 'Renamed Project');
    assert.notEqual(saved.config.revision, read.revision);
    assert.deepEqual(await service.getManagedServiceConfig(), {
      backend: { url: 'https://ember.example' }
    });

    writeFileSync(join(game, 'ember.config.json'), `${readFileSync(join(game, 'ember.config.json'), 'utf8')} `);
    let conflict = null;
    try {
      await service.saveConfig({
        projectId: added.project.id,
        text: saved.config.text,
        expectedRevision: saved.config.revision
      });
    } catch (error) {
      conflict = publicError(error);
    }
    assert.equal(conflict.code, 'CONFIG_CHANGED_EXTERNALLY');
    await service.readConfig(added.project.id);

    const prepared = await service.prepareTest({ projectId: added.project.id, profile: 'smoke' });
    const run = await prepared.agent.runProfile(prepared.config, prepared.root, prepared.profile, {});
    assert.equal(run.status, 'completed');
    const artifacts = await service.persistTestResult({
      project: prepared.project,
      config: prepared.config,
      root: prepared.root,
      run
    });
    assert.ok(Array.isArray(artifacts.report.bugs));
    writeFileSync(join(game, '.ember', 'reports', 'broken-local-report.json'), '{not valid json');
    const reports = await service.listReports(added.project.id);
    assert.equal(reports.length, 2, 'returns one entry for every local report file');
    const validReport = reports.find((report) => report.id === artifacts.report.id);
    assert.ok(Array.isArray(validReport.bugs), 'loads the complete valid report');
    assert.ok(Array.isArray(validReport.blockers), 'preserves complete report fields');
    const corruptReport = reports.find((report) => report.kind === 'corrupt-report');
    assert.equal(corruptReport.id, 'broken-local-report');
    assert.equal(corruptReport.projectId, added.project.id);
    assert.equal(corruptReport.projectName, 'Renamed Project');
    assert.equal(corruptReport.loadError.code, 'REPORT_INVALID');

    const preserved = await service.persistTestResult({
      project: prepared.project,
      config: prepared.config,
      root: prepared.root,
      run,
      beforeSaveReport: async () => { throw new Error('private enrichment failure'); }
    });
    assert.ok(preserved.reportFile, 'optional enrichment failure does not block report persistence');
    assert.equal(preserved.report.enrichmentFailures[0].code, 'REPORT_ENRICHMENT_FAILED');
    assert.equal(JSON.stringify(preserved.report).includes('private enrichment failure'), false);

    const removed = await service.removeProject(added.project.id);
    assert.equal(removed.projectFilesPreserved, true);
    assert.ok(existsSync(join(game, 'ember.config.json')));
    console.log('✓ desktop project service tests passed');
  } finally {
    const target = resolve(base);
    const safeRoot = resolve(tmpdir());
    if (!target.startsWith(safeRoot) || !target.includes('ember-project-service-')) throw new Error('Unsafe test cleanup target');
    rmSync(target, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
