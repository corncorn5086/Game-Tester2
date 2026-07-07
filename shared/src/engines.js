/**
 * Engine profiles: how Ember plugs into each engine — where logs live,
 * how to launch/test, which files to analyze, and what integrations come next.
 * Used by `ember init` (config generation), engine detection, and the
 * Engine Setup screen in Ember Desktop.
 */

export const ENGINES = {
  unity: {
    key: 'unity',
    label: 'Unity',
    detect: {
      // Presence of these marks a Unity project root.
      dirs: ['Assets', 'ProjectSettings'],
      files: ['ProjectSettings/ProjectVersion.txt']
    },
    logs: {
      hint: 'Editor log: ~/Library/Logs/Unity/Editor.log (macOS), %LOCALAPPDATA%/Unity/Editor/Editor.log (Windows). Player log: ~/Library/Logs/<Company>/<Product>/Player.log or %USERPROFILE%/AppData/LocalLow/<Company>/<Product>/Player.log',
      errorPatterns: [
        { pattern: 'NullReferenceException', severity: 'high', category: 'crash', label: 'Null reference exception' },
        { pattern: 'MissingReferenceException', severity: 'high', category: 'crash', label: 'Missing reference (destroyed object used)' },
        { pattern: 'IndexOutOfRangeException', severity: 'high', category: 'crash', label: 'Index out of range' },
        { pattern: 'ArgumentNullException', severity: 'medium', category: 'crash', label: 'Argument null' },
        { pattern: 'StackOverflowException', severity: 'critical', category: 'crash', label: 'Stack overflow' },
        { pattern: 'OutOfMemoryException', severity: 'critical', category: 'performance', label: 'Out of memory' },
        { pattern: 'Fatal error', severity: 'critical', category: 'crash', label: 'Fatal engine error' },
        { pattern: 'The referenced script.*is missing', severity: 'medium', category: 'build', label: 'Missing script reference' },
        { pattern: 'Shader error', severity: 'medium', category: 'visual', label: 'Shader compilation error' }
      ]
    },
    commands: {
      build: 'Unity -batchmode -quit -projectPath . -buildTarget <target> -executeMethod BuildScript.Build',
      test: 'Unity -batchmode -runTests -projectPath . -testResults results.xml -testPlatform EditMode',
      launch: 'Open the built player executable, or press Play via Unity Editor'
    },
    analyze: {
      sourcePaths: ['Assets'],
      includeExtensions: ['.cs', '.shader', '.asmdef', '.json'],
      ignorePaths: ['Library', 'Temp', 'obj', 'Logs', 'UserSettings', '.git']
    },
    futureIntegrations: ['Unity package (UPM) with in-editor Ember panel', 'Play-mode input driver', 'Test Framework bridge', 'Crash Reporting ingestion']
  },

  unreal: {
    key: 'unreal',
    label: 'Unreal Engine',
    detect: {
      dirs: ['Content', 'Config'],
      files: [],
      extensions: ['.uproject']
    },
    logs: {
      hint: 'Saved/Logs/<ProjectName>.log inside the project; crash dumps in Saved/Crashes.',
      errorPatterns: [
        { pattern: 'Fatal error', severity: 'critical', category: 'crash', label: 'Fatal error' },
        { pattern: 'Assertion failed', severity: 'critical', category: 'crash', label: 'Assertion failure' },
        { pattern: 'Access violation', severity: 'critical', category: 'crash', label: 'Access violation' },
        { pattern: 'LogOutOfMemory', severity: 'critical', category: 'performance', label: 'Out of memory' },
        { pattern: 'Ensure condition failed', severity: 'high', category: 'gameplay', label: 'Ensure failure' },
        { pattern: 'LogBlueprint.*Error', severity: 'high', category: 'gameplay', label: 'Blueprint runtime error' },
        { pattern: 'LogShaderCompilers.*Error', severity: 'medium', category: 'visual', label: 'Shader compile error' },
        { pattern: 'LogNet.*Error', severity: 'medium', category: 'network', label: 'Networking error' }
      ]
    },
    commands: {
      build: 'RunUAT BuildCookRun -project=<Game>.uproject -build -cook -stage',
      test: 'UnrealEditor-Cmd <Game>.uproject -ExecCmds="Automation RunTests <Filter>" -unattended -nopause',
      launch: 'UnrealEditor <Game>.uproject -game'
    },
    analyze: {
      sourcePaths: ['Source', 'Config', 'Plugins'],
      includeExtensions: ['.cpp', '.h', '.cs', '.ini', '.uplugin'],
      ignorePaths: ['Binaries', 'Intermediate', 'DerivedDataCache', 'Saved', '.git']
    },
    futureIntegrations: ['Unreal plugin with Ember automation bridge', 'Gauntlet test integration', 'Crash Reporter ingestion', 'Insights trace analysis']
  },

  godot: {
    key: 'godot',
    label: 'Godot',
    detect: {
      dirs: [],
      files: ['project.godot']
    },
    logs: {
      hint: 'Run with --log-file ember-godot.log, or read user://logs/godot.log (enable file logging in Project Settings).',
      errorPatterns: [
        { pattern: 'ERROR:', severity: 'high', category: 'crash', label: 'Engine error' },
        { pattern: 'SCRIPT ERROR', severity: 'high', category: 'gameplay', label: 'Script error' },
        { pattern: 'Invalid get index', severity: 'high', category: 'crash', label: 'Invalid index access' },
        { pattern: 'Attempt to call function .* on a null instance', severity: 'high', category: 'crash', label: 'Null instance call' },
        { pattern: 'WARNING:', severity: 'low', category: 'gameplay', label: 'Engine warning' }
      ]
    },
    commands: {
      build: 'godot --headless --export-release "<preset>" build/game',
      test: 'godot --headless -s addons/gut/gut_cmdln.gd  (with GUT test framework)',
      launch: 'godot --path .'
    },
    analyze: {
      sourcePaths: ['.'],
      includeExtensions: ['.gd', '.cs', '.tscn', '.tres', '.godot', '.cfg'],
      ignorePaths: ['.godot', '.import', 'build', '.git']
    },
    futureIntegrations: ['Godot addon (editor plugin) with Ember dock', 'GUT/GdUnit bridge', 'Headless scene fuzzer']
  },

  web: {
    key: 'web',
    label: 'Web game',
    detect: {
      dirs: [],
      files: ['package.json'],
      packageHints: ['phaser', 'pixi.js', 'three', 'babylonjs', '@babylonjs/core', 'excalibur', 'kaboom', 'melonjs']
    },
    logs: {
      hint: 'Pipe browser console to a file via your dev server, or configure Playwright to capture console + pageerror events into logsPath.',
      errorPatterns: [
        { pattern: 'Uncaught (TypeError|ReferenceError|RangeError)', severity: 'high', category: 'crash', label: 'Uncaught JS exception' },
        { pattern: 'Cannot read propert(y|ies) of (null|undefined)', severity: 'high', category: 'crash', label: 'Null/undefined access' },
        { pattern: 'Maximum call stack size exceeded', severity: 'critical', category: 'crash', label: 'Stack overflow' },
        { pattern: 'WebGL.*(lost|error)', severity: 'high', category: 'visual', label: 'WebGL context problem' },
        { pattern: 'Failed to load resource', severity: 'medium', category: 'build', label: 'Missing asset' },
        { pattern: '\\[violation\\]', severity: 'low', category: 'performance', label: 'Performance violation' }
      ]
    },
    commands: {
      build: 'npm run build',
      test: 'npm test',
      launch: 'npm run dev'
    },
    analyze: {
      sourcePaths: ['src'],
      includeExtensions: ['.js', '.ts', '.jsx', '.tsx', '.json', '.html', '.css'],
      ignorePaths: ['node_modules', 'dist', 'build', '.git']
    },
    futureIntegrations: ['Playwright-driven gameplay runner (input fuzzing in a real browser)', 'JS/TS SDK (ember-sdk) for in-game event reporting', 'CI/CD GitHub Action']
  },

  custom: {
    key: 'custom',
    label: 'Custom engine',
    detect: { dirs: [], files: [] },
    logs: {
      hint: 'Point logsPath at wherever your engine writes logs; add customRules and error patterns matching your log format.',
      errorPatterns: [
        { pattern: '(?:^|\\s)(FATAL|CRITICAL)(?::|\\s)', severity: 'critical', category: 'crash', label: 'Fatal log entry' },
        { pattern: '(?:^|\\s)ERROR(?::|\\s)', severity: 'high', category: 'crash', label: 'Error log entry' },
        { pattern: 'exception|traceback|stack trace', severity: 'high', category: 'crash', label: 'Exception trace' },
        { pattern: '(?:^|\\s)WARN(?:ING)?(?::|\\s)', severity: 'low', category: 'gameplay', label: 'Warning log entry' }
      ]
    },
    commands: {
      build: 'your build command (make, cmake --build, cargo build…)',
      test: 'your test command',
      launch: 'your run command'
    },
    analyze: {
      sourcePaths: ['src'],
      includeExtensions: ['.c', '.cpp', '.h', '.hpp', '.rs', '.py', '.lua', '.js', '.ts', '.cs', '.java', '.kt', '.go'],
      ignorePaths: ['build', 'target', 'bin', 'obj', 'node_modules', '.git']
    },
    futureIntegrations: ['C SDK / IPC protocol for engine hooks', 'Python SDK', 'Generic JSON event ingestion']
  }
};

export const ENGINE_KEYS = Object.keys(ENGINES);
