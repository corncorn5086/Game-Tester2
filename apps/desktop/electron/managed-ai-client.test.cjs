const assert = require('node:assert');
const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const {
  DEFAULT_TIMEOUT_MS,
  createManagedAIClient,
  removeLegacyAICredentialFile,
  stripProviderSecretsFromEnvironment
} = require('./managed-ai-client.cjs');

const jsonResponse = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload
});

function completeReport(overrides = {}) {
  return {
    id: 'rpt_local_only',
    project: {
      name: 'Ember Test',
      engine: 'unity',
      root: 'C:\\private\\game',
      credentials: { secret: 'must-stay-local' }
    },
    metrics: {
      filesScanned: 42,
      logsAnalyzed: 3,
      bugsFound: 1,
      crashRisk: 'medium',
      buildHealth: 'passing',
      regressionRisk: 'low',
      severityBreakdown: { critical: 0, high: 1, medium: 0, low: 0 },
      rawExecutionDetails: { token: 'nested-must-stay-local' }
    },
    blockers: [{ message: 'No blocker', code: 'PRIVATE_CODE', nested: { password: 'private' } }],
    bugs: [{
      id: 'bug_123',
      title: 'Frame hitch',
      severity: 'high',
      category: 'performance',
      source: 'static-analysis',
      evidence: 'Profiler evidence at C:\\private\\game\\Assets\\Scripts\\Player.cs and /home/private/game.log; token=visible-secret-must-be-masked',
      filesInvolved: [
        'C:\\private\\game\\Assets\\Scripts\\Player.cs',
        'C:\\another-user\\private.txt',
        'Assets/Scripts/Relative.cs'
      ],
      stepsToReproduce: ['Open C:\\private\\game\\Scenes\\Main.unity then inspect /var/private/game.log'],
      regressionRisk: 'medium',
      reproducibilityConfidence: 'high',
      line: 27,
      rawSource: 'provider-key-must-not-leave-desktop',
      arbitraryNestedContent: { apiKey: 'nested-provider-key' }
    }],
    apiKey: 'top-level-provider-key',
    executions: [{ stdout: 'private command output' }],
    ...overrides
  };
}

async function main() {
  const environment = {
    PATH: 'safe',
    API_URL: 'https://ember.example',
    OPENAI_API_KEY: 'must-disappear',
    OPENAI_KEY: 'bare-provider-key-must-disappear',
    ANTHROPIC_API_KEY: 'must-disappear-too',
    AZURE_OPENAI_SECRET: 'also-disappear'
  };
  assert.equal(stripProviderSecretsFromEnvironment(environment), 4);
  assert.deepEqual(environment, { PATH: 'safe', API_URL: 'https://ember.example' });

  const calls = [];
  const client = createManagedAIClient({
    defaultBaseUrl: 'https://ember.example',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/ai/status')) {
        const authenticated = typeof options.headers.authorization === 'string';
        return jsonResponse(200, {
          managed: true,
          enabled: true,
          provider: 'openai',
          model: 'managed-model',
          requiresAuthentication: true,
          authenticated,
          message: authenticated ? 'Managed AI ready' : 'Sign in'
        });
      }
      return jsonResponse(200, {
        ok: true,
        managed: true,
        summary: {
          ok: true,
          text: 'Real managed summary',
          provider: 'openai',
          model: 'managed-model',
          requestId: 'resp_managed_1',
          durationMs: 820
        },
        triage: [{
          bugId: 'bug_123',
          ok: true,
          provider: 'openai',
          model: 'managed-model',
          requestId: 'resp_managed_2',
          durationMs: 910,
          insufficientInfo: false,
          rootCause: 'Cause',
          fix: 'Fix',
          reproSteps: ['Step'],
          priorityScore: 80,
          priorityLabel: 'P1 - Critical',
          devMessage: 'Message'
        }],
        durationMs: 1_730
      });
    }
  });

  const publicStatus = await client.getStatus();
  assert.equal(publicStatus.managed, true);
  assert.equal(publicStatus.enabled, true, 'server capability remains visible');
  assert.equal(publicStatus.available, false, 'provider capability is not customer authorization');
  assert.equal(publicStatus.configured, true, 'provider configuration is distinct from customer authorization');
  assert.equal(publicStatus.authorized, false);
  assert.equal('verified' in publicStatus, false, 'status never claims the provider credential was verified');
  assert.equal(publicStatus.status, 'authentication-required');
  assert.equal(calls[0].url, 'https://ember.example/ai/status');
  assert.equal(calls[0].options.headers.authorization, undefined);

  const sessionToken = 'ember-session-token-value';
  const config = { backend: { url: 'https://ember.example/', token: 'plaintext-config-token-must-be-ignored' } };
  const authenticatedStatus = await client.getStatus({ config, sessionToken });
  assert.equal(authenticatedStatus.status, 'authorized');
  assert.equal(authenticatedStatus.available, true);
  assert.equal(authenticatedStatus.configured, true);
  assert.equal(authenticatedStatus.authorized, true);
  assert.equal(calls[1].options.headers.authorization, `Bearer ${sessionToken}`);

  const verificationClient = createManagedAIClient({
    defaultBaseUrl: 'https://ember.example',
    fetchImpl: async (url) => url.endsWith('/ai/status')
      ? jsonResponse(200, {
          managed: true,
          enabled: true,
          provider: 'openai',
          model: 'managed-model',
          requiresAuthentication: true,
          authenticated: true,
          authorized: false,
          reason: 'account_verification_required',
          message: 'Verify your Ember account before using managed AI.'
        })
      : jsonResponse(403, {
          error: 'Verify your Ember account before using managed AI.',
          code: 'AI_ACCOUNT_VERIFICATION_REQUIRED'
        })
  });
  const verificationStatus = await verificationClient.getStatus({ config, sessionToken });
  assert.equal(verificationStatus.enabled, true, 'provider availability remains distinct from account access');
  assert.equal(verificationStatus.authenticated, true);
  assert.equal(verificationStatus.authorized, false, 'an explicit backend denial is never upgraded locally');
  assert.equal(verificationStatus.available, false);
  assert.equal(verificationStatus.status, 'verification-required');
  assert.equal(verificationStatus.reason, 'account_verification_required');
  await assert.rejects(
    verificationClient.analyze(completeReport(), { config, sessionToken }),
    (error) => error.code === 'AI_ACCOUNT_VERIFICATION_REQUIRED'
      && error.details.status === 403
      && error.details.reason === 'account_verification_required'
      && /verify/i.test(error.message)
  );

  const report = completeReport();
  report.bugs.push(
    { id: 'bug_234', title: 'Minor issue', severity: 'low', category: 'ui', source: 'scan' },
    { id: 'bug_345', title: 'Medium issue', severity: 'medium', category: 'logic', source: 'scan' },
    { id: 'bug_456', title: 'Another low issue', severity: 'low', category: 'ui', source: 'scan' }
  );
  const analysis = await client.analyze(report, { config, sessionToken, maxBugs: 9 });
  assert.equal(analysis.managed, true);
  assert.equal(analysis.summary.requestId, 'resp_managed_1');
  assert.equal(analysis.triage[0].bugId, 'bug_123');
  const analyzeCall = calls[2];
  assert.equal(analyzeCall.url, 'https://ember.example/ai/analyze');
  assert.equal(analyzeCall.options.headers.authorization, `Bearer ${sessionToken}`);
  assert.notEqual(analyzeCall.options.headers.authorization, 'Bearer plaintext-config-token-must-be-ignored');
  assert.equal(analyzeCall.options.redirect, 'error');

  const outbound = JSON.parse(analyzeCall.options.body);
  assert.deepEqual(Object.keys(outbound).sort(), ['maxBugs', 'report']);
  assert.equal(outbound.maxBugs, 3);
  assert.deepEqual(Object.keys(outbound.report).sort(), ['blockers', 'bugs', 'metrics', 'project']);
  assert.deepEqual(Object.keys(outbound.report.project).sort(), ['engine', 'name']);
  assert.equal('root' in outbound.report.project, false);
  assert.equal(outbound.report.bugs.length, 3, 'only the three highest-severity bugs leave the device');
  assert.deepEqual(outbound.report.bugs.map((bug) => bug.id), ['bug_123', 'bug_345', 'bug_234']);
  assert.deepEqual(Object.keys(outbound.report.blockers[0]), ['message']);
  assert.deepEqual(Object.keys(outbound.report.bugs[0]).sort(), [
    'category', 'evidence', 'filesInvolved', 'id', 'line', 'regressionRisk',
    'reproducibilityConfidence', 'severity', 'source', 'stepsToReproduce', 'title'
  ]);
  assert.equal('rawSource' in outbound.report.bugs[0], false);
  assert.equal('arbitraryNestedContent' in outbound.report.bugs[0], false);
  assert.equal('executions' in outbound.report, false);
  assert.equal('apiKey' in outbound.report, false);
  assert.match(outbound.report.bugs[0].evidence, /\*\*\*MASKED\*\*\*/);
  assert.deepEqual(outbound.report.bugs[0].filesInvolved, ['Assets/Scripts/Player.cs', 'Assets/Scripts/Relative.cs']);
  assert.equal(/[A-Za-z]:[\\/]/.test(analyzeCall.options.body), false, 'Windows absolute paths are scrubbed');
  assert.equal(analyzeCall.options.body.includes('/home/private'), false, 'Unix absolute paths are scrubbed');
  assert.equal(analyzeCall.options.body.includes('/var/private'), false, 'absolute paths inside free text are scrubbed');
  for (const forbidden of [
    'provider-key-must-not-leave-desktop', 'nested-provider-key', 'top-level-provider-key',
    'must-stay-local', 'nested-must-stay-local', 'visible-secret-must-be-masked', 'private command output',
    'plaintext-config-token-must-be-ignored'
  ]) {
    assert.equal(analyzeCall.options.body.includes(forbidden), false, `${forbidden} must stay local`);
  }
  assert.equal('provider' in outbound, false);
  assert.equal('credentials' in outbound, false);

  let calledWithoutAuth = false;
  const authClient = createManagedAIClient({
    defaultBaseUrl: 'https://ember.example',
    fetchImpl: async () => { calledWithoutAuth = true; return jsonResponse(500, {}); }
  });
  await assert.rejects(
    authClient.analyze(completeReport()),
    (error) => error.code === 'AI_AUTH_REQUIRED'
  );
  assert.equal(calledWithoutAuth, false, 'managed analysis never sends an unauthenticated report');

  const unauthorizedClient = createManagedAIClient({
    defaultBaseUrl: 'https://ember.example',
    fetchImpl: async () => jsonResponse(401, { error: 'Authentication required' })
  });
  await assert.rejects(
    unauthorizedClient.analyze(completeReport(), { config, sessionToken }),
    (error) => error.code === 'AI_AUTH_REQUIRED' && error.details.status === 401
  );

  let oversizeCalled = false;
  const oversizedClient = createManagedAIClient({
    defaultBaseUrl: 'https://ember.example',
    fetchImpl: async () => { oversizeCalled = true; return jsonResponse(200, {}); }
  });
  const oversizedBugs = Array.from({ length: 3 }, (_, index) => ({
    id: `bug_${index}`,
    title: `Large evidence ${index}`,
    severity: 'medium',
    category: 'code-quality',
    source: 'static-analysis',
    evidence: 'x'.repeat(12_000),
    stepsToReproduce: Array.from({ length: 50 }, () => '\u00e9'.repeat(2_000))
  }));
  await assert.rejects(
    oversizedClient.analyze(completeReport({ bugs: oversizedBugs }), { config, sessionToken }),
    (error) => error.code === 'AI_PAYLOAD_TOO_LARGE'
  );
  assert.equal(oversizeCalled, false, 'oversized managed payload is rejected before fetch');

  const aborted = new AbortController();
  aborted.abort('stop');
  const cancelClient = createManagedAIClient({
    defaultBaseUrl: 'https://ember.example',
    fetchImpl: async (_url, options) => {
      if (options.signal.aborted) {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }
      return jsonResponse(200, {});
    }
  });
  await assert.rejects(
    cancelClient.analyze(completeReport(), { config, sessionToken, signal: aborted.signal }),
    (error) => error.code === 'AI_CANCELLED'
  );

  assert.throws(
    () => createManagedAIClient({ defaultBaseUrl: 'http://remote.example', fetchImpl: async () => jsonResponse(200, {}) }),
    (error) => error.code === 'AI_SERVICE_URL_INSECURE'
  );
  assert.doesNotThrow(
    () => createManagedAIClient({ defaultBaseUrl: 'http://[::1]:4310', fetchImpl: async () => jsonResponse(200, {}) })
  );
  assert.ok(DEFAULT_TIMEOUT_MS >= 250_000, 'managed analysis allows the backend sequential provider budget');

  const cleanupRoot = mkdtempSync(join(tmpdir(), 'ember-ai-cleanup-'));
  try {
    const legacy = join(cleanupRoot, 'ai-credentials.v1.json');
    const sibling = join(cleanupRoot, 'workspace-v1.json');
    writeFileSync(legacy, '{"openai":"plaintext-fixture"}');
    writeFileSync(sibling, '{"keep":true}');
    assert.deepEqual(await removeLegacyAICredentialFile(cleanupRoot), { removed: true });
    assert.equal(existsSync(legacy), false);
    assert.equal(existsSync(sibling), true, 'cleanup removes only the exact legacy file');
    assert.deepEqual(await removeLegacyAICredentialFile(cleanupRoot), { removed: false });
  } finally {
    const target = resolve(cleanupRoot);
    const safeRoot = resolve(tmpdir());
    if (!target.startsWith(safeRoot) || !target.includes('ember-ai-cleanup-')) throw new Error('Unsafe test cleanup target');
    rmSync(target, { recursive: true, force: true });
  }

  console.log('✓ desktop managed AI client tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
