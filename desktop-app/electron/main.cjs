/**
 * Ember Desktop — secure Electron shell and local agent bridge.
 *
 * The renderer remains sandboxed. Filesystem access, native dialogs and agent
 * execution are exposed only through the narrow API defined in preload.cjs.
 */
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { startStaticServer } = require('./static-server.cjs');
const { DesktopBridgeError, createProjectService, publicError } = require('./project-service.cjs');
const { createAuthSessionService } = require('./auth-session.cjs');
const { resolveDesktopServiceConfig } = require('./public-service-config.cjs');
const {
  createManagedAIClient,
  removeLegacyAICredentialFile,
  stripProviderSecretsFromEnvironment
} = require('./managed-ai-client.cjs');

// Provider credentials are server-owned. Purge any inherited provider secret
// before the agent core or a project command can observe the Desktop process.
stripProviderSecretsFromEnvironment(process.env);

const MAX_CONCURRENT_RUNS = 2;
const AI_TRIAGE_LIMIT = 3;

let staticServer = null;
let projectService = null;
let managedAIClient = null;
let authSessionService = null;
let desktopServiceConfig = null;
let agentPromise = null;
let checksPromise = null;
let ipcRegistered = false;
const activeRuns = new Map();
let pendingRunStarts = 0;

function loadAgent() {
  if (!agentPromise) {
    const specifier = app.isPackaged
      ? pathToFileURL(join(process.resourcesPath, 'ember-core', 'node_modules', '@ember', 'agent', 'src', 'index.js')).href
      : '@ember/agent';
    agentPromise = import(specifier).catch((error) => {
      throw new DesktopBridgeError(
        'AGENT_CORE_UNAVAILABLE',
        'Le noyau local Ember n’a pas pu être chargé.',
        { packaged: app.isPackaged },
        error
      );
    });
  }
  return agentPromise;
}

function loadChecks() {
  if (!checksPromise) {
    const specifier = app.isPackaged
      ? pathToFileURL(join(process.resourcesPath, 'ember-core', 'node_modules', '@ember', 'shared', 'src', 'checks.js')).href
      : '@ember/shared/checks';
    checksPromise = import(specifier).catch((error) => {
      throw new DesktopBridgeError(
        'AGENT_CORE_UNAVAILABLE',
        'Le catalogue de capacités Ember n’a pas pu être chargé.',
        { packaged: app.isPackaged },
        error
      );
    });
  }
  return checksPromise;
}

async function createWindow() {
  if (!staticServer) {
    staticServer = await startStaticServer(join(__dirname, '..', 'standalone'));
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#f4efe7',
    title: 'Ember Desktop',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const appUrl = `http://127.0.0.1:${staticServer.port}/`;
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  // A navigated remote page must never inherit Ember's preload bridge.
  win.webContents.on('will-navigate', (event, url) => {
    if (isTrustedAppUrl(url)) return;
    event.preventDefault();
    if (isExternalUrl(url)) shell.openExternal(url).catch(() => {});
  });

  win.webContents.on('destroyed', () => {
    for (const record of activeRuns.values()) {
      if (record.senderId === win.webContents.id) record.controller.abort(new Error('La fenêtre Ember a été fermée.'));
    }
  });

  await win.loadURL(appUrl);
  return win;
}

function registerIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;

  handle('ember:workspace:get', async () => {
    const workspace = await projectService.getWorkspace();
    return { ...workspace, activeRuns: activeRunViews() };
  });

  handle('ember:project:choose-folder', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Choisir le dossier de votre jeu',
      buttonLabel: 'Choisir ce dossier',
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    return {
      canceled: result.canceled || result.filePaths.length === 0,
      path: result.canceled ? null : result.filePaths[0] || null
    };
  });

  handle('ember:project:inspect', (_event, payload) => projectService.inspectProject(payload?.path));
  handle('ember:project:add', async (_event, payload) => withActiveRuns(await projectService.addProject({
    path: payload?.path,
    candidate: payload?.candidate
  })));
  handle('ember:project:select', async (_event, payload) => withActiveRuns(await projectService.selectProject(payload?.id)));

  handle('ember:project:remove', async (_event, payload) => {
    const running = [...activeRuns.values()].find((record) => record.projectId === payload?.id);
    if (running) {
      throw new DesktopBridgeError('PROJECT_TEST_RUNNING', 'Arrêtez le test en cours avant de retirer ce projet.', { runId: running.runId });
    }
    return withActiveRuns(await projectService.removeProject(payload?.id));
  });

  handle('ember:reports:list', (_event, payload) => projectService.listReports(payload?.projectId || null));
  handle('ember:config:read', (_event, payload) => projectService.readConfig(payload?.projectId));
  handle('ember:config:save', async (_event, payload) => withActiveRuns(await projectService.saveConfig(payload)));
  handle('ember:ai:status', async () => {
    const sessionToken = await authSessionService.getSessionToken({ baseUrl: desktopServiceConfig.backend.url });
    return managedAIClient.getStatus({ config: desktopServiceConfig, sessionToken });
  });
  handle('ember:auth:status', async () => authSessionService.getStatus({ baseUrl: desktopServiceConfig.backend.url }));
  handle('ember:auth:login', async (_event, payload) => authSessionService.login(
    { email: payload?.email, password: payload?.password },
    { baseUrl: desktopServiceConfig.backend.url }
  ));
  handle('ember:auth:signup', async (_event, payload) => {
    return authSessionService.signup({
      name: payload?.name,
      email: payload?.email,
      password: payload?.password,
      tosAccepted: payload?.tosAccepted,
      language: payload?.language
    }, { baseUrl: desktopServiceConfig.backend.url });
  });
  handle('ember:auth:update-profile', async (_event, payload) => authSessionService.updateProfile(
    { name: payload?.name },
    { baseUrl: desktopServiceConfig.backend.url }
  ));
  handle('ember:auth:change-password', async (_event, payload) => authSessionService.changePassword(
    { currentPassword: payload?.currentPassword, newPassword: payload?.newPassword },
    { baseUrl: desktopServiceConfig.backend.url }
  ));
  handle('ember:auth:logout', async () => authSessionService.logout({ baseUrl: desktopServiceConfig.backend.url }));
  handle('ember:test:start', startTest);
  handle('ember:test:stop', stopTest);
}

function handle(channel, operation) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      assertTrustedSender(event);
      return { ok: true, value: await operation(event, payload) };
    } catch (error) {
      const serialized = publicError(error);
      if (serialized.code === 'INTERNAL_ERROR') console.error(`[ember-desktop] ${channel}`, error);
      return { ok: false, error: serialized };
    }
  });
}

async function startTest(event, payload) {
  if (activeRuns.size + pendingRunStarts >= MAX_CONCURRENT_RUNS) {
    throw new DesktopBridgeError('TEST_LIMIT_REACHED', `Ember exécute déjà ${MAX_CONCURRENT_RUNS} tests simultanément.`);
  }
  pendingRunStarts += 1;
  try {
  let projectId = payload?.projectId;
  if (!projectId && payload?.path) {
    const added = await projectService.addProject({ path: payload.path });
    projectId = added.project.id;
  }
  const prepared = await projectService.prepareTest({
    projectId,
    profile: payload?.profile || 'smoke'
  });
  const existing = [...activeRuns.values()].find((record) => record.projectId === prepared.project.id);
  if (existing) {
    throw new DesktopBridgeError('TEST_ALREADY_RUNNING', 'Un test est déjà en cours pour ce projet.', { runId: existing.runId });
  }
  if (prepared.commands.length > 0 && payload?.allowCommands !== true) {
    throw new DesktopBridgeError(
      'COMMAND_CONFIRMATION_REQUIRED',
      'Ce profil doit exécuter des commandes locales. Confirmez-les avant de continuer.',
      {
        profile: prepared.profile,
        commands: prepared.commands.map((item) => ({
          check: item.check,
          command: prepared.agent.maskSecrets(item.command)
        }))
      }
    );
  }

  const enableAI = payload?.enableAI === true;
  if (enableAI) {
    const managedConfig = desktopServiceConfig;
    const sessionToken = await authSessionService.getSessionToken({ baseUrl: managedConfig.backend.url });
    const status = await managedAIClient.getStatus({ config: managedConfig, sessionToken });
    if (!status.enabled) {
      throw new DesktopBridgeError(
        status.status === 'offline' ? 'AI_SERVICE_UNREACHABLE' : 'AI_MANAGED_UNAVAILABLE',
        status.message || 'Le service IA géré n’est pas disponible. L’analyse locale reste disponible.',
        { managed: true, reason: status.reason || status.status }
      );
    }
    if (status.requiresAuthentication && !status.authenticated) {
      throw new DesktopBridgeError(
        'AI_AUTH_REQUIRED',
        'Connectez ce projet à une session Ember valide avant d’activer l’analyse IA gérée.',
        { managed: true, reason: 'authentication-required' }
      );
    }
    if (!status.authorized) {
      throw new DesktopBridgeError(
        status.reason === 'account_verification_required'
          ? 'AI_ACCOUNT_VERIFICATION_REQUIRED'
          : 'AI_AUTH_REQUIRED',
        status.message || 'Ce compte Ember n’est pas autorisé à utiliser l’analyse IA gérée.',
        { managed: true, reason: status.reason || status.status }
      );
    }
    prepared.aiOptions = {
      enabled: true,
      managed: true,
      provider: status.provider,
      model: status.model,
      config: managedConfig,
      sessionToken
    };
  } else {
    prepared.aiOptions = { enabled: false };
  }

  const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  const controller = new AbortController();
  const record = {
    runId,
    projectId: prepared.project.id,
    projectName: prepared.project.name,
    profile: prepared.profile,
    aiEnabled: enableAI,
    aiProvider: enableAI ? prepared.aiOptions.provider : null,
    status: 'running',
    startedAt: new Date().toISOString(),
    sender: event.sender,
    senderId: event.sender.id,
    controller
  };
  if (activeRuns.size >= MAX_CONCURRENT_RUNS) {
    throw new DesktopBridgeError('TEST_LIMIT_REACHED', `Ember exécute déjà ${MAX_CONCURRENT_RUNS} tests simultanément.`);
  }
  activeRuns.set(runId, record);
  executeTest(record, prepared).catch((error) => console.error('[ember-desktop] unhandled run error', error));

  return runView(record);
  } finally {
    pendingRunStarts = Math.max(0, pendingRunStarts - 1);
  }
}

async function stopTest(_event, payload) {
  const runId = payload?.runId;
  if (typeof runId !== 'string' || !/^run_[\w-]+$/.test(runId)) {
    throw new DesktopBridgeError('INVALID_ARGUMENT', 'runId est invalide.');
  }
  const record = activeRuns.get(runId);
  if (!record) throw new DesktopBridgeError('RUN_NOT_ACTIVE', 'Ce test est déjà terminé ou n’existe plus.', { runId });
  if (record.status !== 'stopping') {
    record.status = 'stopping';
    record.controller.abort(new Error('Test arrêté par l’utilisateur.'));
    emitProgress(record, { type: 'stop-requested', message: 'Arrêt du test en cours…' });
  }
  return runView(record);
}

async function executeTest(record, prepared) {
  try {
    const run = await prepared.agent.runProfile(prepared.config, prepared.root, prepared.profile, {
      signal: record.controller.signal,
      onStep(step) {
        emitProgress(record, { type: 'step', step: safeStep(step, prepared.agent.maskSensitive || prepared.agent.maskSecrets) });
      }
    });
    const artifacts = await projectService.persistTestResult({
      project: prepared.project,
      config: prepared.config,
      root: prepared.root,
      run,
      beforeSaveReport: prepared.aiOptions?.enabled && run.status !== 'cancelled'
        ? (report) => safelyEnrichReportWithAI({ report, run, record, agent: prepared.agent, options: prepared.aiOptions })
        : null
    });
    record.status = record.controller.signal.aborted ? 'cancelled' : run.status;
    emitProgress(record, {
      type: 'complete',
      run: {
        runId: record.runId,
        projectId: record.projectId,
        profile: run.profile,
        status: record.status,
        deterministicStatus: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        durationMs: run.durationMs,
        checksPassed: run.checksPassed,
        checksFailed: run.checksFailed,
        checksBlocked: run.checksBlocked,
        commandsExecuted: run.commandsExecuted,
        steps: run.steps
          .filter((step) => step.type !== 'output')
          .map((step) => safeStep(step, prepared.agent.maskSensitive || prepared.agent.maskSecrets)),
        ai: run.ai || null
      },
      report: artifacts.report,
      persistence: {
        runSaved: !!artifacts.runFile,
        reportSaved: !!artifacts.reportFile,
        deterministicReportPreserved: !!artifacts.report && run.status !== 'cancelled',
        aiStatus: artifacts.report?.ai?.status || null
      }
    });
  } catch (error) {
    record.status = record.controller.signal.aborted ? 'cancelled' : 'failed';
    emitProgress(record, {
      type: 'error',
      status: record.status,
      error: publicError(error)
    });
  } finally {
    activeRuns.delete(record.runId);
  }
}

async function safelyEnrichReportWithAI({ report, run, record, agent, options }) {
  try {
    await enrichReportWithAI({ report, run, record, agent, options });
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message = agent.maskSecrets(error?.message || String(error)).slice(0, 2_000);
    const ai = {
      requested: true,
      status: record.controller.signal.aborted ? 'cancelled' : 'failed',
      requestedProvider: 'managed',
      provider: safeProvider(options?.provider),
      model: cleanMetadata(options?.model),
      requestId: null,
      startedAt: finishedAt,
      finishedAt,
      durationMs: 0,
      callsAttempted: 0,
      callsCompleted: 0,
      callsFailed: 1,
      triageLimit: AI_TRIAGE_LIMIT,
      triagesCompleted: 0,
      calls: [],
      error: {
        code: record.controller.signal.aborted ? 'AI_CANCELLED' : 'AI_ENRICHMENT_FAILED',
        message
      }
    };
    emitProgress(record, {
      type: 'ai-error',
      stage: 'enrichment',
      provider: ai.provider,
      model: ai.model,
      durationMs: 0,
      cancelled: record.controller.signal.aborted,
      error: ai.error,
      message: record.controller.signal.aborted
        ? 'Le travail IA a été annulé. Le rapport local complet sera conservé.'
        : `La relecture IA a échoué sans interrompre le rapport local : ${message}`
    });
    try {
      applyAIMetadata(report, run, ai, null);
    } catch (metadataError) {
      // Last-resort preservation: even a metadata formatting defect must not
      // prevent the deterministic report and run from being written.
      report.ai = ai;
      run.ai = ai;
      console.error('[ember-desktop] AI failure metadata fallback', publicError(metadataError));
    }
  }
}

async function enrichReportWithAI({ report, run, record, agent, options }) {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const calls = [];
  const triages = {};
  let actualProvider = safeProvider(options.provider);
  let actualModel = cleanMetadata(options.model);
  let summaryRequestId = null;

  const fail = (error, { sentToService = true } = {}) => {
    const cancelled = record.controller.signal.aborted || error?.code === 'AI_CANCELLED';
    const publicFailure = publicError(error);
    const safeError = safeAIError(publicFailure.message, agent.maskSecrets, cancelled);
    const durationMs = Date.now() - startedAtMs;
    if (sentToService) {
      calls.push({
        stage: 'managed-analysis',
        provider: actualProvider,
        model: actualModel,
        requestId: null,
        durationMs,
        status: cancelled ? 'cancelled' : 'failed',
        errorCode: publicFailure.code || safeError.code
      });
    }
    emitProgress(record, {
      type: 'ai-error',
      managed: true,
      stage: 'managed-analysis',
      provider: actualProvider,
      model: actualModel,
      durationMs,
      cancelled,
      sentToProvider: sentToService,
      error: { code: publicFailure.code || safeError.code, message: safeError.message },
      message: cancelled
        ? 'L’analyse IA gérée a été annulée. Le rapport local déterministe sera conservé.'
        : `Le service IA géré n’a pas terminé l’analyse : ${safeError.message}`
    });
    const ai = {
      ...finalizeAIMetadata({
        startedAt,
        startedAtMs,
        status: cancelled ? 'cancelled' : 'failed',
        requestedProvider: 'managed',
        provider: actualProvider,
        model: actualModel,
        requestId: null,
        calls,
        completedCalls: 0,
        failedCalls: sentToService ? 1 : 0,
        triageLimit: AI_TRIAGE_LIMIT,
        triagesCompleted: 0
      }),
      managed: true,
      serviceOwnedCredentials: true
    };
    applyAIMetadata(report, run, ai, null);
  };

  if (record.controller.signal.aborted) {
    fail(new DesktopBridgeError('AI_CANCELLED', 'L’analyse IA gérée a été annulée.'), { sentToService: false });
    return;
  }

  emitProgress(record, {
    type: 'ai-start',
    managed: true,
    stage: 'managed-analysis',
    provider: actualProvider,
    model: actualModel,
    total: Math.min(AI_TRIAGE_LIMIT, Array.isArray(report.bugs) ? report.bugs.length : 0),
    message: 'Le service Ember géré prépare un résumé et le triage des problèmes réels.'
  });

  let result;
  try {
    result = await managedAIClient.analyze(report, {
      config: options.config,
      sessionToken: options.sessionToken,
      maxBugs: AI_TRIAGE_LIMIT,
      signal: record.controller.signal
    });
  } catch (error) {
    fail(error);
    return;
  }

  const summary = result.summary;
  let completedCalls = 0;
  let failedCalls = 0;
  if (summary?.ok && summary.text) {
    actualProvider = safeProvider(summary.provider) || actualProvider;
    actualModel = cleanMetadata(summary.model) || actualModel;
    summaryRequestId = cleanRequestId(summary.requestId);
    report.aiExecutiveSummary = agent.maskSecrets(summary.text).slice(0, 12_000);
    report.aiProvider = actualProvider;
    report.aiModel = actualModel;
    report.aiRequestId = summaryRequestId;
    completedCalls++;
    calls.push({
      stage: 'summary',
      bugId: null,
      provider: actualProvider,
      model: actualModel,
      requestId: summaryRequestId,
      durationMs: positiveDuration(summary.durationMs),
      status: 'completed'
    });
    emitProgress(record, {
      type: 'ai-complete',
      managed: true,
      stage: 'summary',
      provider: actualProvider,
      model: actualModel,
      requestId: summaryRequestId,
      durationMs: positiveDuration(summary.durationMs),
      message: `Résumé reçu du service géré en ${formatDuration(summary.durationMs)}.`
    });
  } else {
    failedCalls++;
    calls.push({
      stage: 'summary',
      bugId: null,
      provider: actualProvider,
      model: actualModel,
      requestId: null,
      durationMs: 0,
      status: 'failed',
      errorCode: 'AI_SUMMARY_MISSING'
    });
  }

  for (let index = 0; index < result.triage.length; index++) {
    const item = result.triage[index];
    if (!item.ok) {
      failedCalls++;
      calls.push({
        stage: 'triage',
        bugId: cleanBugId(item.bugId),
        provider: safeProvider(item.provider) || actualProvider,
        model: cleanMetadata(item.model) || actualModel,
        requestId: cleanRequestId(item.requestId),
        durationMs: positiveDuration(item.durationMs),
        status: 'failed',
        errorCode: 'AI_TRIAGE_FAILED'
      });
      continue;
    }
    const triageKey = cleanBugId(item.bugId);
    if (!triageKey) continue;
    actualProvider = safeProvider(item.provider) || actualProvider;
    actualModel = cleanMetadata(item.model) || actualModel;
    const triage = safeTriage(item, {
      agent,
      bugId: triageKey,
      durationMs: item.durationMs,
      requestId: item.requestId
    });
    triages[triageKey] = triage;
    completedCalls++;
    calls.push({
      stage: 'triage',
      bugId: triageKey,
      provider: triage.provider,
      model: triage.model,
      requestId: triage.requestId,
      durationMs: triage.durationMs,
      status: 'completed'
    });
    emitProgress(record, {
      type: 'ai-complete',
      managed: true,
      stage: 'triage',
      provider: triage.provider,
      model: triage.model,
      requestId: triage.requestId,
      durationMs: triage.durationMs,
      bugId: triageKey,
      index: index + 1,
      total: result.triage.length,
      message: `Triage ${index + 1}/${result.triage.length} reçu du service géré en ${formatDuration(triage.durationMs)}.`
    });
  }

  const status = failedCalls === 0 && completedCalls > 0
    ? 'completed'
    : completedCalls > 0
      ? 'partial'
      : 'failed';
  const ai = {
    ...finalizeAIMetadata({
      startedAt,
      startedAtMs,
      status,
      requestedProvider: 'managed',
      provider: actualProvider,
      model: actualModel,
      requestId: summaryRequestId,
      calls,
      completedCalls,
      failedCalls,
      triageLimit: AI_TRIAGE_LIMIT,
      triagesCompleted: Object.keys(triages).length
    }),
    managed: true,
    serviceOwnedCredentials: true,
    providerDurationMs: positiveDuration(result.durationMs),
    roundTripDurationMs: positiveDuration(result.roundTripDurationMs)
  };
  applyAIMetadata(report, run, ai, triages);
  emitProgress(record, {
    type: 'ai-complete',
    managed: true,
    stage: 'managed-analysis',
    provider: actualProvider,
    model: actualModel,
    requestId: summaryRequestId,
    durationMs: ai.roundTripDurationMs,
    providerDurationMs: ai.providerDurationMs,
    callsCompleted: completedCalls,
    callsFailed: failedCalls,
    message: `Analyse IA gérée terminée en ${formatDuration(ai.roundTripDurationMs)}.`
  });
}

function applyAIMetadata(report, run, ai, triages) {
  const deterministicDurationMs = positiveDuration(run.deterministicDurationMs ?? run.durationMs);
  const deterministicFinishedAt = run.deterministicFinishedAt || run.finishedAt;
  const overallFinishedAt = new Date().toISOString();
  const parsedStart = Date.parse(run.startedAt);
  const overallDurationMs = Number.isFinite(parsedStart)
    ? Math.max(deterministicDurationMs, Date.now() - parsedStart)
    : deterministicDurationMs + positiveDuration(ai.durationMs);
  const persistedAI = {
    ...ai,
    deterministicAnalysisStatus: run.status,
    deterministicAnalysisComplete: true,
    deterministicReportIncluded: true
  };
  report.ai = persistedAI;
  if (triages) report.aiTriages = triages;
  report.aiDurationMs = persistedAI.durationMs;
  if (report.testRun) {
    report.testRun.deterministicFinishedAt = deterministicFinishedAt;
    report.testRun.deterministicDurationMs = deterministicDurationMs;
    report.testRun.finishedAt = overallFinishedAt;
    report.testRun.durationMs = overallDurationMs;
  }
  run.deterministicFinishedAt = deterministicFinishedAt;
  run.deterministicDurationMs = deterministicDurationMs;
  run.finishedAt = overallFinishedAt;
  run.durationMs = overallDurationMs;
  run.ai = persistedAI;
}

function finalizeAIMetadata({ startedAt, startedAtMs, status, requestedProvider, provider, model, requestId, calls, completedCalls, failedCalls, triageLimit, triagesCompleted }) {
  return {
    requested: true,
    status,
    requestedProvider: requestedProvider === 'auto' ? 'auto' : safeProvider(requestedProvider),
    provider: safeProvider(provider),
    model: cleanMetadata(model),
    requestId: cleanRequestId(requestId),
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    callsAttempted: calls.length,
    callsCompleted: completedCalls,
    callsFailed: failedCalls,
    triageLimit,
    triagesCompleted,
    calls
  };
}

function safeTriage(result, { agent, bugId, durationMs, requestId }) {
  const text = (value, max = 12_000) => value == null
    ? null
    : agent.maskSecrets(String(value)).slice(0, max);
  return {
    bugId: cleanBugId(bugId),
    provider: safeProvider(result.provider),
    model: cleanMetadata(result.model),
    requestId: cleanRequestId(requestId),
    durationMs: positiveDuration(durationMs),
    insufficientInfo: result.insufficientInfo === true,
    insufficientReason: text(result.insufficientReason),
    rootCause: text(result.rootCause),
    fix: text(result.fix),
    reproSteps: (Array.isArray(result.reproSteps) ? result.reproSteps : []).slice(0, 20).map((step) => text(step, 2_000)),
    priorityScore: Number.isFinite(result.priorityScore) ? Math.max(0, Math.min(100, result.priorityScore)) : null,
    priorityLabel: text(result.priorityLabel, 80),
    devMessage: text(result.devMessage)
  };
}

function emitProgress(record, payload) {
  if (!record.sender || record.sender.isDestroyed()) return;
  record.sender.send('ember:test:progress', {
    runId: record.runId,
    projectId: record.projectId,
    profile: record.profile,
    at: new Date().toISOString(),
    ...payload
  });
}

function safeStep(step, sanitize = (value) => value) {
  let masked = step;
  try { masked = sanitize(step); } catch { /* fall back to field-level masking below */ }
  if (!masked || typeof masked !== 'object' || Array.isArray(masked)) masked = {};
  const maskText = (value, max = 64 * 1024) => {
    let result = String(value ?? '');
    try {
      const candidate = sanitize(result);
      if (typeof candidate === 'string') result = candidate;
    } catch { /* keep already-stringified value */ }
    return result.slice(0, max);
  };
  const safe = {
    at: typeof masked.at === 'string' ? maskText(masked.at, 80) : new Date().toISOString(),
    type: typeof masked.type === 'string' ? maskText(masked.type, 48) : 'progress',
    check: typeof masked.check === 'string' ? maskText(masked.check, 100) : null,
    message: maskText(masked.message || '')
  };
  if (typeof masked.phase === 'string') safe.phase = maskText(masked.phase, 80);
  if (typeof masked.stage === 'string') safe.stage = maskText(masked.stage, 120);
  if (typeof masked.currentFile === 'string') safe.currentFile = maskText(masked.currentFile, 4_096);
  if (Number.isFinite(masked.currentLine)) safe.currentLine = Math.max(0, Math.floor(masked.currentLine));
  if (Number.isFinite(masked.currentFileLines)) safe.currentFileLines = Math.max(0, Math.floor(masked.currentFileLines));
  if (masked.stream === 'stdout' || masked.stream === 'stderr') safe.stream = masked.stream;
  if (masked.counts && typeof masked.counts === 'object') safe.counts = safeTelemetryValue(masked.counts, maskText);
  if (masked.data != null) safe.data = safeTelemetryValue(masked.data, maskText);
  return safe;
}

function safeTelemetryValue(value, maskText, depth = 0) {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return maskText(value, 16 * 1024);
  if (depth >= 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeTelemetryValue(item, maskText, depth + 1));
  if (typeof value !== 'object') return maskText(String(value), 1_000);
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
    const safeKey = maskText(key, 160);
    result[safeKey] = safeTelemetryValue(item, maskText, depth + 1);
  }
  return result;
}

function safeProvider(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{2,80}$/.test(value) ? value : null;
}

function cleanMetadata(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160) || null
    : null;
}

function cleanRequestId(value) {
  const cleaned = cleanMetadata(value);
  return cleaned && /^(resp_|msg_)[A-Za-z0-9_-]+$/.test(cleaned) ? cleaned : null;
}

function cleanBugId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{3,160}$/.test(value) ? value : null;
}

function safeAIError(value, mask = (text) => String(text ?? ''), cancelled = false) {
  if (cancelled) return { code: 'AI_CANCELLED', message: 'La requête IA a été annulée.' };
  const message = mask(String(value || 'Le fournisseur IA n’a pas retourné de résultat.')).slice(0, 2_000);
  return { code: 'AI_REQUEST_FAILED', message };
}

function positiveDuration(value) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function formatDuration(durationMs) {
  const seconds = positiveDuration(durationMs) / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
}

function severityRank(value) {
  return { critical: 4, high: 3, medium: 2, low: 1 }[value] || 0;
}

function activeRunViews() {
  return [...activeRuns.values()].map(runView);
}

function withActiveRuns(result) {
  if (!result?.workspace) return result;
  return {
    ...result,
    workspace: {
      ...result.workspace,
      activeRuns: activeRunViews()
    }
  };
}

function runView(record) {
  return {
    runId: record.runId,
    projectId: record.projectId,
    projectName: record.projectName,
    profile: record.profile,
    aiEnabled: record.aiEnabled === true,
    aiProvider: safeProvider(record.aiProvider),
    status: record.status,
    startedAt: record.startedAt
  };
}

function assertTrustedSender(event) {
  if (!event?.sender || event.sender.isDestroyed() || event.senderFrame?.parent || !isTrustedAppUrl(event.senderFrame?.url || event.sender.getURL())) {
    throw new DesktopBridgeError('UNTRUSTED_RENDERER', 'Cette requête ne provient pas de la fenêtre Ember autorisée.');
  }
}

function isTrustedAppUrl(value) {
  if (!staticServer) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) === staticServer.port;
  } catch {
    return false;
  }
}

function isExternalUrl(value) {
  try {
    return ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

app.whenReady().then(async () => {
  desktopServiceConfig = resolveDesktopServiceConfig({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath
  });
  managedAIClient = createManagedAIClient({
    defaultBaseUrl: desktopServiceConfig.backend.url
  });
  authSessionService = createAuthSessionService({
    dataDir: app.getPath('userData'),
    safeStorage,
    defaultBaseUrl: desktopServiceConfig.backend.url
  });
  try {
    await removeLegacyAICredentialFile(app.getPath('userData'));
  } catch (error) {
    // Never log the legacy file path or its former contents.
    console.warn(`[ember-desktop] ${error?.code || 'AI_LEGACY_CREDENTIAL_CLEANUP_FAILED'}`);
  }
  projectService = createProjectService({
    dataDir: app.getPath('userData'),
    loadAgent,
    loadChecks
  });
  registerIpc();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow().catch((error) => console.error('[ember-desktop] window', error));
  });
}).catch((error) => {
  console.error('[ember-desktop] startup failed', error);
  app.quit();
});

app.on('before-quit', () => {
  for (const record of activeRuns.values()) record.controller.abort(new Error('Ember se ferme.'));
});

app.on('will-quit', () => {
  if (staticServer) staticServer.close();
  staticServer = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
