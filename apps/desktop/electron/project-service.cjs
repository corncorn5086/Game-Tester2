const { constants: fsConstants } = require('node:fs');
const {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} = require('node:fs/promises');
const { createHash, randomUUID } = require('node:crypto');
const { basename, dirname, extname, isAbsolute, join, relative, resolve } = require('node:path');

const CONFIG_FILENAME = 'ember.config.json';
const WORKSPACE_VERSION = 1;
const SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.cs', '.gd', '.go', '.java', '.js', '.jsx',
  '.kt', '.lua', '.py', '.rs', '.shader', '.ts', '.tsx', '.uplugin', '.uproject'
]);
const BUILD_EXTENSIONS = new Set(['.apk', '.appimage', '.exe', '.ipa', '.wasm', '.x86_64']);
const SHALLOW_IGNORE = new Set([
  '.git', '.ember', '.godot', 'binaries', 'build', 'deriveddatacache', 'dist', 'intermediate',
  'library', 'node_modules', 'temp', 'target'
]);

class DesktopBridgeError extends Error {
  constructor(code, message, details = null, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DesktopBridgeError';
    this.code = code;
    this.details = details;
  }
}

function publicError(error) {
  if (error instanceof DesktopBridgeError) {
    return { code: error.code, message: error.message, details: error.details ?? null };
  }
  const code = error?.code;
  if (code === 'ENOENT') return { code: 'PROJECT_NOT_FOUND', message: 'Le dossier sélectionné n’existe plus.', details: null };
  if (code === 'ENOTDIR') return { code: 'PROJECT_NOT_A_DIRECTORY', message: 'Le chemin sélectionné n’est pas un dossier.', details: null };
  if (code === 'EACCES' || code === 'EPERM') {
    return { code: 'PROJECT_PERMISSION_DENIED', message: 'Ember n’a pas l’autorisation de lire ou modifier ce dossier.', details: null };
  }
  return { code: 'INTERNAL_ERROR', message: 'Une erreur locale inattendue est survenue.', details: null };
}

function createProjectService({ dataDir, loadAgent, loadChecks }) {
  if (!dataDir || typeof loadAgent !== 'function' || typeof loadChecks !== 'function') {
    throw new TypeError('createProjectService requires dataDir, loadAgent and loadChecks');
  }

  const workspacePath = join(dataDir, 'workspace-v1.json');
  let mutationQueue = Promise.resolve();

  function emptyWorkspace() {
    return { version: WORKSPACE_VERSION, selectedProjectId: null, projects: [] };
  }

  async function readWorkspace() {
    try {
      const parsed = JSON.parse(await readFile(workspacePath, 'utf8'));
      if (!parsed || !Array.isArray(parsed.projects)) throw new Error('invalid workspace shape');
      const projects = parsed.projects.filter(isStoredProject).map((project) => ({ ...project }));
      const selectedProjectId = projects.some((project) => project.id === parsed.selectedProjectId)
        ? parsed.selectedProjectId
        : projects[0]?.id ?? null;
      return { version: WORKSPACE_VERSION, selectedProjectId, projects };
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyWorkspace();
      await mkdir(dataDir, { recursive: true });
      const corruptPath = `${workspacePath}.corrupt-${Date.now()}`;
      await rename(workspacePath, corruptPath).catch(() => {});
      return emptyWorkspace();
    }
  }

  async function writeWorkspace(workspace) {
    await mkdir(dataDir, { recursive: true });
    const temporary = `${workspacePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(workspace, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      await rename(temporary, workspacePath);
    } catch (error) {
      if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error;
      await rm(workspacePath, { force: true });
      await rename(temporary, workspacePath);
    }
  }

  function mutateWorkspace(mutator) {
    const task = async () => {
      const workspace = await readWorkspace();
      const result = await mutator(workspace);
      await writeWorkspace(workspace);
      return result;
    };
    mutationQueue = mutationQueue.then(task, task);
    return mutationQueue;
  }

  async function getWorkspace() {
    const workspace = await readWorkspace();
    return workspaceView(workspace);
  }

  async function inspectProject(inputPath) {
    const selectedPath = await canonicalDirectory(inputPath);
    const selectedEntries = await readableEntries(selectedPath);
    const selectedWritable = await canWrite(selectedPath);
    const agent = await loadAgent();

    const exactConfigPath = join(selectedPath, CONFIG_FILENAME);
    let configExists = false;
    let configValid = false;
    let config = null;
    let configErrors = [];
    let configWarnings = [];
    let configRevision = null;
    let root = selectedPath;

    try {
      const raw = await readFile(exactConfigPath, 'utf8');
      configExists = true;
      configRevision = revisionOf(raw);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        configErrors = [`${CONFIG_FILENAME} n’est pas un JSON valide : ${error.message}`];
      }
      if (parsed) {
        const result = agent.validateConfig(parsed);
        configErrors = result.errors;
        configWarnings = result.warnings;
        configValid = result.valid;
        if (result.valid) {
          config = parsed;
          try {
            root = await canonicalDirectory(resolve(selectedPath, parsed.gamePath || '.'));
          } catch (error) {
            configValid = false;
            configErrors.push(error.message);
          }
          if (configValid && !isInside(selectedPath, root)) {
            configValid = false;
            configErrors.push('"gamePath" doit rester dans le dossier sélectionné.');
          }
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw mapFsError(error, selectedPath, 'read');
    }

    const generated = agent.generateConfig(selectedPath, { write: false });
    const scanConfig = configValid ? config : generated.config;
    const effectiveRoot = configValid ? root : selectedPath;
    const writable = selectedWritable && await canWrite(effectiveRoot);
    const detection = agent.detectEngine(effectiveRoot);
    const scan = agent.scanProject({
      ...scanConfig,
      maxFiles: Math.min(Math.max(Number(scanConfig.maxFiles) || 5000, 1), 5000)
    }, effectiveRoot);
    const buildArtifacts = await discoverBuildArtifacts(effectiveRoot);
    const effectiveEntries = samePath(selectedPath, effectiveRoot) ? selectedEntries : await readableEntries(effectiveRoot);
    const importantFiles = await discoverImportantFiles(effectiveRoot, effectiveEntries, configExists ? exactConfigPath : null);
    const hasSource = scan.sourceFiles.some((file) => SOURCE_EXTENSIONS.has(file.ext));
    const recognizedMarker = detection.confidence !== 'low';
    const issues = [];
    const warnings = [];

    if (configExists && !configValid) {
      issues.push({
        code: 'CONFIG_INVALID',
        severity: 'error',
        message: `${CONFIG_FILENAME} contient des erreurs et doit être corrigé avant d’ajouter le projet.`,
        details: configErrors
      });
    }
    if (!writable) {
      issues.push({
        code: 'PROJECT_PERMISSION_DENIED',
        severity: 'error',
        message: 'Ember peut lire ce dossier, mais ne peut pas y enregistrer sa configuration et ses rapports.'
      });
    }
    if (scan.filesScanned === 0) {
      issues.push({ code: 'PROJECT_EMPTY', severity: 'error', message: 'Ce dossier est vide ou ne contient aucun fichier lisible.' });
    } else if (!configValid && !recognizedMarker && !hasSource && buildArtifacts.length === 0) {
      issues.push({
        code: 'PROJECT_NOT_RECOGNIZED',
        severity: 'error',
        message: 'Ce dossier ne ressemble pas à un projet de jeu, une build ou un dossier de code admissible.'
      });
    }

    if (!configValid && detection.engine === 'custom' && detection.confidence === 'low' && hasSource) {
      warnings.push({
        code: 'ENGINE_NOT_RECOGNIZED',
        message: 'Le moteur n’a pas été reconnu. Ember ajoutera ce dossier comme projet à moteur personnalisé.'
      });
    }
    if (buildArtifacts.length > 0 && !hasSource) {
      warnings.push({
        code: 'BUILD_ONLY',
        message: 'Une build a été détectée, mais aucun code source. Les tests disponibles seront limités aux signaux d’exécution configurés.'
      });
    }
    if (configValid && detection.confidence === 'high' && config.engine !== detection.engine) {
      warnings.push({
        code: 'ENGINE_MISMATCH',
        message: `La configuration indique ${config.engine}, mais les fichiers correspondent à ${detection.engine}.`
      });
    }
    configWarnings.forEach((message) => warnings.push({ code: 'CONFIG_WARNING', message }));

    const effectiveConfig = configValid ? config : { ...generated.config, engine: detection.engine };
    const capabilities = await buildCapabilities({
      agent,
      loadChecks,
      config: effectiveConfig,
      root: effectiveRoot,
      hasSource,
      buildArtifacts
    });
    const type = hasSource
      ? (recognizedMarker ? 'source-project' : 'code-project')
      : buildArtifacts.length > 0
        ? 'build'
        : 'unknown';

    return {
      path: selectedPath,
      root: effectiveRoot,
      configPath: exactConfigPath,
      name: configValid ? config.projectName : basename(selectedPath),
      engine: configValid ? config.engine : detection.engine,
      type,
      admissible: issues.length === 0,
      permissions: { read: true, write: writable },
      detection: {
        engine: detection.engine,
        confidence: detection.confidence,
        evidence: detection.evidence
      },
      config: {
        exists: configExists,
        valid: configValid,
        path: exactConfigPath,
        errors: configErrors,
        warnings: configWarnings,
        revision: configRevision,
        preview: redactConfig(effectiveConfig)
      },
      scan: {
        filesScanned: scan.filesScanned,
        sourceFileCount: scan.sourceFileCount,
        dirsVisited: scan.dirsVisited,
        totalBytes: scan.totalBytes,
        truncated: scan.truncated,
        byExtension: scan.byExtension,
        sourceSamples: scan.sourceFiles.slice(0, 20).map((file) => file.path)
      },
      importantFiles,
      buildArtifacts,
      capabilities,
      testProfiles: describeProfiles(effectiveConfig, capabilities),
      issues,
      warnings
    };
  }

  async function addProject(candidateOrPath) {
    const nestedCandidate = typeof candidateOrPath === 'object' ? candidateOrPath?.candidate : null;
    const requestedPath = typeof candidateOrPath === 'string'
      ? candidateOrPath
      : candidateOrPath?.path || nestedCandidate?.path || candidateOrPath?.root || nestedCandidate?.root;
    const requestedName = cleanProjectName(
      typeof candidateOrPath === 'object' ? candidateOrPath?.name || nestedCandidate?.name : null
    );
    let candidate = await inspectProject(requestedPath);

    if (!candidate.admissible) {
      throw new DesktopBridgeError(
        candidate.issues[0]?.code || 'PROJECT_NOT_RECOGNIZED',
        candidate.issues[0]?.message || 'Ce projet ne peut pas être ajouté.',
        { candidate }
      );
    }

    if (!candidate.config.exists) {
      const agent = await loadAgent();
      let generated;
      try {
        generated = agent.generateConfig(candidate.path, {
          engine: candidate.engine,
          projectName: requestedName || candidate.name,
          write: true
        });
      } catch (error) {
        throw mapFsError(error, candidate.path, 'write');
      }
      if (generated.error) {
        // A config may have appeared between inspection and confirmation.
        candidate = await inspectProject(candidate.path);
        if (!candidate.config.valid) {
          throw new DesktopBridgeError('CONFIG_WRITE_FAILED', generated.error, { path: generated.path });
        }
      } else {
        candidate = await inspectProject(candidate.path);
      }
    }

    if (!candidate.config.valid) {
      throw new DesktopBridgeError('CONFIG_INVALID', `${CONFIG_FILENAME} n’est pas valide.`, { errors: candidate.config.errors });
    }

    return mutateWorkspace((workspace) => {
      const duplicate = workspace.projects.find((project) => samePath(project.path, candidate.root));
      const now = new Date().toISOString();
      const project = {
        id: duplicate?.id || `prj_${randomUUID()}`,
        name: candidate.name,
        engine: candidate.engine,
        type: candidate.type,
        path: candidate.root,
        directory: candidate.path,
        configPath: candidate.configPath,
        configRevision: candidate.config.revision,
        detection: candidate.detection,
        capabilities: candidate.capabilities,
        addedAt: duplicate?.addedAt || now,
        updatedAt: now,
        lastUsedAt: now
      };
      if (duplicate) Object.assign(duplicate, project);
      else workspace.projects.unshift(project);
      workspace.selectedProjectId = project.id;
      return { project: { ...project }, created: !duplicate, workspace: workspaceView(workspace) };
    });
  }

  async function selectProject(projectId) {
    assertId(projectId, 'projectId');
    return mutateWorkspace((workspace) => {
      const project = workspace.projects.find((item) => item.id === projectId);
      if (!project) throw new DesktopBridgeError('PROJECT_NOT_REGISTERED', 'Ce projet n’est plus enregistré dans Ember.', { projectId });
      project.lastUsedAt = new Date().toISOString();
      workspace.selectedProjectId = project.id;
      return { project: { ...project }, workspace: workspaceView(workspace) };
    });
  }

  async function removeProject(projectId) {
    assertId(projectId, 'projectId');
    return mutateWorkspace((workspace) => {
      const index = workspace.projects.findIndex((item) => item.id === projectId);
      if (index < 0) throw new DesktopBridgeError('PROJECT_NOT_REGISTERED', 'Ce projet n’est plus enregistré dans Ember.', { projectId });
      const [removed] = workspace.projects.splice(index, 1);
      if (workspace.selectedProjectId === projectId) workspace.selectedProjectId = workspace.projects[0]?.id ?? null;
      return {
        removed: { ...removed },
        projectFilesPreserved: true,
        workspace: workspaceView(workspace)
      };
    });
  }

  async function listReports(projectId = null) {
    const workspace = await readWorkspace();
    const projects = projectId
      ? [findProject(workspace, projectId)]
      : workspace.projects;
    const agent = await loadAgent();
    const reports = [];
    for (const project of projects) {
      const root = await resolveStoredProjectRoot(project, agent);
      const store = new agent.LocalStore(root);
      for (const stored of store.listReports()) {
        try {
          const report = JSON.parse(await readFile(stored.file, 'utf8'));
          if (!report || typeof report !== 'object' || Array.isArray(report)) {
            const invalidShape = new TypeError('Report JSON must contain an object.');
            invalidShape.code = 'REPORT_INVALID_SHAPE';
            throw invalidShape;
          }
          reports.push({ ...report, projectId: project.id, projectName: project.name });
        } catch (error) {
          reports.push({
            id: stored.id,
            generatedAt: stored.generatedAt,
            projectId: project.id,
            projectName: project.name,
            kind: 'corrupt-report',
            loadError: {
              code: 'REPORT_INVALID',
              message: 'Ce rapport local est illisible ou contient un JSON invalide.',
              systemCode: error?.code || null
            }
          });
        }
      }
    }
    return reports.sort((a, b) => String(b.generatedAt || '').localeCompare(String(a.generatedAt || '')));
  }

  async function prepareTest({ projectId, profile = 'smoke' } = {}) {
    assertId(projectId, 'projectId');
    if (typeof profile !== 'string' || !profile.trim() || profile.length > 80 || /[\u0000-\u001f]/.test(profile)) {
      throw new DesktopBridgeError('INVALID_PROFILE', 'Le profil de test demandé est invalide.');
    }
    const workspace = await readWorkspace();
    const project = findProject(workspace, projectId);
    const agent = await loadAgent();
    const loaded = await loadExactProjectConfig(project, agent);
    const selectedProfile = loaded.config.testProfiles?.[profile];
    if (!selectedProfile) {
      throw new DesktopBridgeError('PROFILE_NOT_FOUND', `Le profil « ${profile} » n’existe pas pour ce projet.`, {
        availableProfiles: Object.keys(loaded.config.testProfiles || {})
      });
    }
    const commands = commandsForProfile(loaded.config, selectedProfile);
    return { agent, project, config: loaded.config, root: loaded.root, profile, commands };
  }

  async function readConfig(projectId) {
    assertId(projectId, 'projectId');
    const workspace = await readWorkspace();
    const project = findProject(workspace, projectId);
    const agent = await loadAgent();
    const loaded = await loadExactProjectConfig(project, agent);
    const revision = revisionOf(loaded.text);
    await mutateWorkspace((latest) => {
      const stored = latest.projects.find((item) => item.id === projectId);
      if (stored) stored.configRevision = revision;
      return null;
    });
    return {
      projectId,
      path: loaded.configPath,
      text: loaded.text,
      revision,
      config: redactConfig(loaded.config)
    };
  }

  async function saveConfig({ projectId, text, expectedRevision = null } = {}) {
    assertId(projectId, 'projectId');
    if (typeof text !== 'string' || !text.trim() || text.length > 1024 * 1024) {
      throw new DesktopBridgeError('INVALID_CONFIG_TEXT', 'La configuration doit être un document JSON de moins de 1 Mo.');
    }
    const workspace = await readWorkspace();
    const project = findProject(workspace, projectId);
    const agent = await loadAgent();
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (error) {
      throw new DesktopBridgeError('CONFIG_INVALID_JSON', `${CONFIG_FILENAME} n’est pas un JSON valide : ${error.message}`);
    }
    const validation = agent.validateConfig(parsed);
    if (!validation.valid) {
      throw new DesktopBridgeError('CONFIG_INVALID', `${CONFIG_FILENAME} contient des erreurs.`, {
        errors: validation.errors,
        warnings: validation.warnings
      });
    }

    const configDirectory = await canonicalDirectory(project.directory || dirname(project.configPath));
    const configPath = join(configDirectory, CONFIG_FILENAME);
    const currentText = await readFile(configPath, 'utf8').catch((error) => { throw mapFsError(error, configPath, 'read'); });
    const currentRevision = revisionOf(currentText);
    const baseline = expectedRevision || project.configRevision;
    if (!baseline) {
      throw new DesktopBridgeError('CONFIG_REVISION_REQUIRED', 'Relisez la configuration avant de l’enregistrer afin d’éviter d’écraser une modification externe.');
    }
    if (baseline !== currentRevision) {
      throw new DesktopBridgeError('CONFIG_CHANGED_EXTERNALLY', 'La configuration a changé sur le disque. Relisez-la avant d’enregistrer vos modifications.', {
        expectedRevision: baseline,
        currentRevision
      });
    }

    const requestedRoot = await canonicalDirectory(resolve(configDirectory, parsed.gamePath || '.'));
    if (!isInside(configDirectory, requestedRoot)) {
      throw new DesktopBridgeError('CONFIG_GAME_PATH_OUTSIDE_PROJECT', 'Le gamePath configuré sort du dossier du projet.');
    }

    const normalized = text.endsWith('\n') ? text : `${text}\n`;
    const temporary = `${configPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      const mode = (await stat(configPath)).mode;
      await writeFile(temporary, normalized, { encoding: 'utf8', mode });
      // rename replaces the file atomically on supported local filesystems. If
      // the platform refuses replacement, keep the original and report it.
      await rename(temporary, configPath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      throw mapFsError(error, configPath, 'write');
    }

    const refreshed = await inspectProject(configDirectory);
    if (!refreshed.config.valid) {
      throw new DesktopBridgeError('CONFIG_INVALID', 'La configuration enregistrée n’a pas pu être rechargée.', { errors: refreshed.config.errors });
    }
    return mutateWorkspace((latest) => {
      const stored = findProject(latest, projectId);
      stored.name = refreshed.name;
      stored.engine = refreshed.engine;
      stored.type = refreshed.type;
      stored.path = refreshed.root;
      stored.configPath = refreshed.configPath;
      stored.configRevision = refreshed.config.revision;
      stored.detection = refreshed.detection;
      stored.capabilities = refreshed.capabilities;
      stored.updatedAt = new Date().toISOString();
      return {
        project: { ...stored },
        workspace: workspaceView(latest),
        config: {
          path: refreshed.configPath,
          text: normalized,
          revision: refreshed.config.revision,
          warnings: validation.warnings
        }
      };
    });
  }

  async function persistTestResult({ project, config, root, run, beforeSaveReport = null }) {
    const agent = await loadAgent();
    const store = new agent.LocalStore(root);
    let report = null;
    let reportFile = null;
    if (run.status !== 'cancelled') {
      report = agent.maskSensitive(agent.buildReport({
        config,
        root,
        scan: run.scan,
        analyze: run.analyze,
        logs: run.logs,
        run
      }));
      const previous = store.latestReport();
      if (previous) {
        const diff = store.compareReports(previous, report);
        report.regression = {
          comparedTo: previous.id,
          fixed: diff.fixed.map((bug) => bug.title),
          stillPresent: diff.stillPresent.length,
          new: diff.new.map((bug) => bug.title)
        };
      }
      if (typeof beforeSaveReport === 'function') {
        try {
          await beforeSaveReport(report);
        } catch {
          // Report enrichment is optional. Never sacrifice the completed local
          // analysis because a managed service or formatting callback failed.
          const prior = Array.isArray(report.enrichmentFailures) ? report.enrichmentFailures.slice(0, 9) : [];
          report.enrichmentFailures = [...prior, {
            kind: 'optional-enrichment',
            code: 'REPORT_ENRICHMENT_FAILED',
            message: 'L’enrichissement optionnel a échoué; le rapport local déterministe a été conservé.'
          }];
        }
      }
      reportFile = store.saveReport(report);
    }
    // Save the run after optional report enrichment so trusted main-process
    // callers can persist matching AI provenance on both artifacts.
    const runFile = store.saveRun(run);
    await mutateWorkspace((workspace) => {
      const stored = workspace.projects.find((item) => item.id === project.id);
      if (stored) {
        stored.lastUsedAt = new Date().toISOString();
        stored.updatedAt = stored.lastUsedAt;
      }
      return null;
    });
    return {
      runFile,
      reportFile,
      report
    };
  }

  async function resolveProject(projectId) {
    const workspace = await readWorkspace();
    return { ...findProject(workspace, projectId) };
  }

  /** Main-process-only connection details for the selected Ember project. */
  async function getManagedServiceConfig(projectId = null) {
    const workspace = await readWorkspace();
    const selectedId = projectId || workspace.selectedProjectId;
    if (!selectedId) return null;
    const project = findProject(workspace, selectedId);
    const agent = await loadAgent();
    const loaded = await loadExactProjectConfig(project, agent);
    const backend = loaded.config?.backend;
    return {
      backend: {
        url: typeof backend?.url === 'string' ? backend.url : ''
      }
    };
  }

  return {
    getWorkspace,
    inspectProject,
    addProject,
    selectProject,
    removeProject,
    listReports,
    readConfig,
    saveConfig,
    prepareTest,
    persistTestResult,
    resolveProject,
    getManagedServiceConfig
  };
}

async function canonicalDirectory(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim() || inputPath.includes('\0') || inputPath.length > 32768) {
    throw new DesktopBridgeError('INVALID_PROJECT_PATH', 'Choisissez un chemin de dossier valide.');
  }
  const absolute = resolve(inputPath.trim());
  let canonical;
  try {
    canonical = await realpath(absolute);
    const info = await stat(canonical);
    if (!info.isDirectory()) throw new DesktopBridgeError('PROJECT_NOT_A_DIRECTORY', 'Le chemin sélectionné n’est pas un dossier.', { path: absolute });
    await access(canonical, fsConstants.R_OK);
  } catch (error) {
    if (error instanceof DesktopBridgeError) throw error;
    throw mapFsError(error, absolute, 'read');
  }
  return canonical;
}

async function readableEntries(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    throw mapFsError(error, path, 'read');
  }
}

function mapFsError(error, path, operation) {
  if (error instanceof DesktopBridgeError) return error;
  if (error?.code === 'ENOENT') {
    return new DesktopBridgeError('PROJECT_NOT_FOUND', 'Le dossier sélectionné n’existe plus.', { path }, error);
  }
  if (error?.code === 'ENOTDIR') {
    return new DesktopBridgeError('PROJECT_NOT_A_DIRECTORY', 'Le chemin sélectionné n’est pas un dossier.', { path }, error);
  }
  if (error?.code === 'EACCES' || error?.code === 'EPERM') {
    return new DesktopBridgeError(
      'PROJECT_PERMISSION_DENIED',
      `Ember n’a pas l’autorisation de ${operation === 'write' ? 'modifier' : 'lire'} ce dossier.`,
      { path, operation },
      error
    );
  }
  return new DesktopBridgeError(
    operation === 'write' ? 'CONFIG_WRITE_FAILED' : 'PROJECT_READ_FAILED',
    operation === 'write' ? 'Ember n’a pas pu écrire la configuration du projet.' : 'Ember n’a pas pu lire ce dossier.',
    { path, systemCode: error?.code || null },
    error
  );
}

async function discoverImportantFiles(root, rootEntries, configPath) {
  const found = [];
  const add = async (kind, path) => {
    try {
      await access(path, fsConstants.R_OK);
      found.push({ kind, path: slash(relative(root, path) || basename(path)) });
    } catch { /* optional marker */ }
  };
  if (configPath) await add('ember-config', configPath);
  await add('unity-assets', join(root, 'Assets'));
  await add('unity-version', join(root, 'ProjectSettings', 'ProjectVersion.txt'));
  await add('godot-project', join(root, 'project.godot'));
  await add('web-package', join(root, 'package.json'));
  await add('cmake-project', join(root, 'CMakeLists.txt'));
  await add('rust-project', join(root, 'Cargo.toml'));
  for (const entry of rootEntries || await readableEntries(root)) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.uproject')) {
      found.push({ kind: 'unreal-project', path: entry.name });
    }
  }
  return uniqueBy(found, (item) => `${item.kind}:${item.path}`);
}

async function discoverBuildArtifacts(root) {
  const artifacts = [];
  const queue = [{ path: root, depth: 0 }];
  let visited = 0;
  while (queue.length && artifacts.length < 16 && visited < 600) {
    const current = queue.shift();
    let entries;
    try { entries = await readdir(current.path, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (++visited >= 600 || artifacts.length >= 16) break;
      const full = join(current.path, entry.name);
      const lower = entry.name.toLowerCase();
      if (entry.isDirectory()) {
        if (lower.endsWith('.app')) artifacts.push({ kind: 'application', path: slash(relative(root, full)) });
        else if (current.depth < 2 && !SHALLOW_IGNORE.has(lower)) queue.push({ path: full, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = extname(lower);
      if (BUILD_EXTENSIONS.has(extension)) {
        artifacts.push({ kind: extension === '.wasm' ? 'web-build' : 'executable-build', path: slash(relative(root, full)) });
      }
    }
  }
  return artifacts;
}

async function buildCapabilities({ agent, loadChecks, config, root, hasSource, buildArtifacts }) {
  const { CHECK_TYPES } = await loadChecks();
  const reports = new agent.LocalStore(root).listReports();
  let logsAvailable = false;
  if (config.logsPath) {
    const logsPath = resolve(root, config.logsPath);
    logsAvailable = isInside(root, logsPath) && await pathExists(logsPath);
  }
  const profileCommands = Object.values(config.testProfiles || {}).flatMap((profile) => profile?.commands || []);

  return CHECK_TYPES.map((check) => {
    if (check.kind === 'integration') {
      return { id: check.id, label: check.label, kind: check.kind, available: false, reason: check.description, requiresConsent: false };
    }
    if (check.id === 'scan') {
      return { id: check.id, label: check.label, kind: check.kind, available: true, reason: 'Le dossier est lisible.', requiresConsent: false };
    }
    if (check.id === 'analyze') {
      return { id: check.id, label: check.label, kind: check.kind, available: hasSource, reason: hasSource ? 'Des fichiers source analysables ont été détectés.' : 'Aucun code source analysable détecté.', requiresConsent: false };
    }
    if (check.id === 'logs') {
      return { id: check.id, label: check.label, kind: check.kind, available: logsAvailable, reason: logsAvailable ? 'Le chemin des journaux est lisible.' : 'Configurez un logsPath lisible.', requiresConsent: false };
    }
    if (check.id === 'regression') {
      return { id: check.id, label: check.label, kind: check.kind, available: true, reason: reports.length ? `${reports.length} rapport(s) disponible(s) comme référence.` : 'Le premier rapport établira la référence.', requiresConsent: false };
    }
    if (check.id === 'custom-command') {
      return { id: check.id, label: check.label, kind: check.kind, available: profileCommands.length > 0, reason: profileCommands.length ? 'Des commandes personnalisées sont configurées.' : 'Aucune commande personnalisée configurée.', requiresConsent: profileCommands.length > 0 };
    }
    if (check.kind === 'command') {
      const command = check.commandField ? config[check.commandField] : '';
      return { id: check.id, label: check.label, kind: check.kind, available: !!command, reason: command ? `La commande ${check.commandField} est configurée.` : `Configurez ${check.commandField}.`, requiresConsent: !!command };
    }
    return { id: check.id, label: check.label, kind: check.kind, available: buildArtifacts.length > 0, reason: check.description, requiresConsent: false };
  });
}

function describeProfiles(config, capabilities) {
  const available = new Map(capabilities.map((capability) => [capability.id, capability]));
  return Object.entries(config.testProfiles || {}).map(([name, profile]) => {
    const checks = Array.isArray(profile?.checks) ? profile.checks : [];
    const commands = commandsForProfile(config, profile);
    return {
      name,
      description: typeof profile?.description === 'string' ? profile.description : '',
      checks,
      availableChecks: checks.filter((id) => available.get(id)?.available),
      blockedChecks: checks.filter((id) => !available.get(id)?.available),
      commandCount: commands.length,
      requiresCommandConsent: commands.length > 0
    };
  });
}

function commandsForProfile(config, profile) {
  const commands = [];
  for (const checkId of Array.isArray(profile?.checks) ? profile.checks : []) {
    const field = { build: 'buildCommand', test: 'testCommand', launch: 'launchCommand' }[checkId];
    if (field && config[field]) commands.push({ check: checkId, command: config[field] });
  }
  for (const command of Array.isArray(profile?.commands) ? profile.commands : []) {
    if (typeof command === 'string' && command.trim()) commands.push({ check: 'custom-command', command });
  }
  return commands;
}

async function loadExactProjectConfig(project, agent) {
  const configDirectory = await canonicalDirectory(project.directory || dirname(project.configPath));
  const configPath = join(configDirectory, CONFIG_FILENAME);
  let parsed;
  let text;
  try {
    text = await readFile(configPath, 'utf8');
    parsed = JSON.parse(text);
  }
  catch (error) {
    if (error?.code) throw mapFsError(error, configPath, 'read');
    throw new DesktopBridgeError('CONFIG_INVALID_JSON', `${CONFIG_FILENAME} n’est pas un JSON valide : ${error.message}`, { path: configPath });
  }
  const validation = agent.validateConfig(parsed);
  if (!validation.valid) {
    throw new DesktopBridgeError('CONFIG_INVALID', `${CONFIG_FILENAME} contient des erreurs.`, {
      path: configPath,
      errors: validation.errors,
      warnings: validation.warnings
    });
  }
  const root = await canonicalDirectory(resolve(configDirectory, parsed.gamePath || '.'));
  if (!isInside(configDirectory, root)) {
    throw new DesktopBridgeError('CONFIG_GAME_PATH_OUTSIDE_PROJECT', 'Le gamePath configuré sort du dossier du projet.', { configDirectory, root });
  }
  return { config: parsed, root, configPath, text };
}

async function resolveStoredProjectRoot(project, agent) {
  return (await loadExactProjectConfig(project, agent)).root;
}

function findProject(workspace, projectId) {
  assertId(projectId, 'projectId');
  const project = workspace.projects.find((item) => item.id === projectId);
  if (!project) throw new DesktopBridgeError('PROJECT_NOT_REGISTERED', 'Ce projet n’est plus enregistré dans Ember.', { projectId });
  return project;
}

function workspaceView(workspace) {
  const projects = workspace.projects.map((project) => ({ ...project }));
  return {
    version: WORKSPACE_VERSION,
    selectedProjectId: workspace.selectedProjectId,
    selectedProject: projects.find((project) => project.id === workspace.selectedProjectId) || null,
    projects
  };
}

function isStoredProject(project) {
  return !!project && typeof project.id === 'string' && typeof project.path === 'string' && typeof project.name === 'string';
}

function assertId(value, label) {
  if (typeof value !== 'string' || !/^[\w-]{3,100}$/.test(value)) {
    throw new DesktopBridgeError('INVALID_ARGUMENT', `${label} est invalide.`);
  }
}

function cleanProjectName(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/[\u0000-\u001f]/g, '');
  return cleaned ? cleaned.slice(0, 120) : null;
}

function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!isAbsolute(rel) && !rel.startsWith('..') && !rel.startsWith('/') && !rel.startsWith('\\'));
}

function samePath(a, b) {
  return process.platform === 'win32'
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);
}

function slash(value) {
  return value.replace(/\\/g, '/');
}

function redactConfig(config) {
  const copy = JSON.parse(JSON.stringify(config || {}));
  if (copy.backend?.token) copy.backend.token = '***MASKED***';
  return copy;
}

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

async function pathExists(path) {
  try { await access(path, fsConstants.R_OK); return true; }
  catch { return false; }
}

async function canWrite(path) {
  try { await access(path, fsConstants.W_OK); return true; }
  catch { return false; }
}

function revisionOf(text) {
  return createHash('sha256').update(text).digest('hex');
}

module.exports = {
  DesktopBridgeError,
  createProjectService,
  publicError
};
