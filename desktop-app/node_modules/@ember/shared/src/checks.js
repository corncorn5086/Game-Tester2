/**
 * Test plan check types. A test plan is a named set of checks; each check
 * either maps to a real agent capability today (kind: 'agent'), runs a
 * configured command (kind: 'command'), or is a structured placeholder for
 * an integration that requires an engine hook (kind: 'integration' —
 * clearly reported as "requires SDK/driver" instead of faking results).
 */

export const CHECK_TYPES = [
  { id: 'scan', label: 'Project scan', kind: 'agent', description: 'Walk project files, detect engine, inventory sources/assets.' },
  { id: 'analyze', label: 'Code analysis', kind: 'agent', description: 'Static analysis: risky patterns, missing error handling, TODO/FIXME, custom rules.' },
  { id: 'logs', label: 'Log analysis', kind: 'agent', description: 'Parse configured logs for crashes, exceptions and engine errors.' },
  { id: 'build', label: 'Build check', kind: 'command', commandField: 'buildCommand', description: 'Run the configured build command and analyze its output.' },
  { id: 'test', label: 'Engine test suite', kind: 'command', commandField: 'testCommand', description: 'Run the configured test command and parse failures.' },
  { id: 'launch', label: 'Launch check', kind: 'command', commandField: 'launchCommand', description: 'Launch the game and watch for early crashes (bounded duration).' },
  { id: 'custom-command', label: 'Custom command', kind: 'command', description: 'Any additional command defined in the test profile.' },

  { id: 'navigation-menu', label: 'Menu navigation', kind: 'integration', description: 'Drive menu flows. Requires input driver (Playwright for web, engine SDK otherwise).' },
  { id: 'controller-input', label: 'Controller input', kind: 'integration', description: 'Synthetic gamepad input sweeps. Requires engine input bridge.' },
  { id: 'keyboard-input', label: 'Keyboard input', kind: 'integration', description: 'Synthetic keyboard input sweeps. Requires engine input bridge.' },
  { id: 'collision', label: 'Collision checks', kind: 'integration', description: 'Probe collision boundaries and out-of-bounds. Requires engine SDK.' },
  { id: 'save-load', label: 'Save/load checks', kind: 'integration', description: 'Save, mutate, reload, diff state. Requires save-system hook.' },
  { id: 'ui-flow', label: 'UI flow checks', kind: 'integration', description: 'Walk UI screens and assert reachability/focus. Requires UI driver.' },
  { id: 'combat-loop', label: 'Combat loop checks', kind: 'integration', description: 'Exercise combat systems with scripted scenarios. Requires SDK.' },
  { id: 'inventory', label: 'Inventory checks', kind: 'integration', description: 'Stress inventory add/remove/stack edge cases. Requires SDK.' },
  { id: 'quest-logic', label: 'Quest logic checks', kind: 'integration', description: 'Validate quest state machines. Requires SDK.' },
  { id: 'performance', label: 'Performance checks', kind: 'integration', description: 'Frame time, memory and load stalls. Requires profiler hook (Insights/Profiler/tracing).' },
  { id: 'regression', label: 'Regression checks', kind: 'agent', description: 'Re-run previous findings and verify fixed bugs stay fixed (compares against stored reports).' },
  { id: 'input-fuzzing', label: 'Random input fuzzing', kind: 'integration', description: 'Randomized input storms. Requires input driver.' },
  { id: 'scripted-scenario', label: 'Scripted scenario', kind: 'integration', description: 'Replay a recorded scenario script. Requires SDK.' }
];

export function getCheck(id) {
  return CHECK_TYPES.find((c) => c.id === id) ?? null;
}

/** Checks that can run today with only a config file (no engine hook). */
export const RUNNABLE_TODAY = CHECK_TYPES.filter((c) => c.kind !== 'integration').map((c) => c.id);
