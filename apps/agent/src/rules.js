/**
 * Built-in static analysis rules. Each rule is a real, explainable heuristic —
 * a regex applied per line (or a file-level check) that flags known
 * bug-prone patterns in game code. Findings always carry file + line evidence.
 *
 * severity: critical | high | medium | low
 * category: shared BUG_CATEGORIES
 */

export const LINE_RULES = [
  // --- universal ---
  {
    id: 'todo-fixme',
    pattern: /\/\/\s*(TODO|FIXME|HACK|XXX)\b|#\s*(TODO|FIXME|HACK|XXX)\b/i,
    extensions: null,
    severity: 'low',
    category: 'gameplay',
    message: 'TODO/FIXME/HACK marker — unfinished or fragile logic',
    suggest: 'Track it as a ticket or resolve it before release.'
  },
  {
    id: 'hardcoded-sleep',
    pattern: /\b(Thread\.Sleep|time\.sleep|await\s+new\s+Promise\(\s*r(?:esolve)?\s*=>\s*setTimeout|WaitForSeconds\(\s*\d{2,})/,
    extensions: null,
    severity: 'medium',
    category: 'performance',
    message: 'Hardcoded long wait/sleep — timing-dependent logic is flaky and hides race conditions',
    suggest: 'Replace fixed waits with event/state-based waiting.'
  },
  {
    id: 'random-seed-time',
    pattern: /new\s+Random\s*\(\s*\)|Random\.InitState\(\s*\(int\)\s*DateTime|srand\s*\(\s*time\s*\(/,
    extensions: null,
    severity: 'low',
    category: 'gameplay',
    message: 'Unseeded/time-seeded RNG — bugs found in this code will be hard to reproduce',
    suggest: 'Expose a seed so test runs are deterministic.'
  },

  // --- C# / Unity ---
  {
    id: 'unity-empty-catch',
    pattern: /catch\s*(\([^)]*\))?\s*\{\s*\}/,
    extensions: ['.cs', '.java', '.kt', '.cpp', '.h'],
    severity: 'high',
    category: 'crash',
    message: 'Empty catch block swallows exceptions — crashes become silent corruption',
    suggest: 'Log the exception and handle or rethrow it.'
  },
  {
    id: 'unity-getcomponent-update',
    pattern: /void\s+(Update|FixedUpdate|LateUpdate)\s*\(/,
    extensions: ['.cs'],
    severity: 'medium',
    category: 'performance',
    message: 'Update loop present — verify no per-frame GetComponent/Find/allocations inside',
    suggest: 'Cache component lookups in Awake/Start.',
    refine: (line, nextLines) => /GetComponent|GameObject\.Find|FindObjectOfType/.test(nextLines),
    refineMessage: 'GetComponent/Find called inside a per-frame Update loop'
  },
  {
    id: 'unity-find-string',
    pattern: /GameObject\.Find\(|FindObjectOfType|transform\.Find\(/,
    extensions: ['.cs'],
    severity: 'medium',
    category: 'performance',
    message: 'String/scene-wide object lookup — slow and breaks silently when objects are renamed',
    suggest: 'Use serialized references or dependency injection.'
  },
  {
    id: 'unity-oncollision-null',
    pattern: /OnCollision(Enter|Stay|Exit)|OnTrigger(Enter|Stay|Exit)/,
    extensions: ['.cs'],
    severity: 'low',
    category: 'gameplay',
    message: 'Collision/trigger handler — common crash source when colliding object was destroyed',
    suggest: 'Null-check other.gameObject and components before use.'
  },
  {
    id: 'cs-async-void',
    pattern: /async\s+void\s+(?!OnDestroy|OnDisable)/,
    extensions: ['.cs'],
    severity: 'high',
    category: 'crash',
    message: 'async void method — exceptions inside cannot be caught and crash the app',
    suggest: 'Return Task (or UniTask) instead of void.'
  },
  {
    id: 'unity-playerprefs-save',
    pattern: /PlayerPrefs\.(GetString|GetInt|GetFloat)\(/,
    extensions: ['.cs'],
    severity: 'low',
    category: 'save-system',
    message: 'PlayerPrefs read — verify defaults are handled for first launch / corrupted prefs',
    suggest: 'Always pass a default value and validate ranges.'
  },

  // --- C/C++ / Unreal ---
  {
    id: 'cpp-raw-deref-cast',
    pattern: /\bCast<[^>]+>\([^)]*\)\s*->/,
    extensions: ['.cpp', '.h'],
    severity: 'high',
    category: 'crash',
    message: 'Immediate dereference of Cast<> result — Cast returns nullptr on failure',
    suggest: 'Store the cast result and null-check before use (or use CastChecked only when guaranteed).'
  },
  {
    id: 'cpp-unchecked-malloc',
    pattern: /=\s*(malloc|calloc|realloc)\s*\(/,
    extensions: ['.c', '.cpp', '.h'],
    severity: 'medium',
    category: 'crash',
    message: 'Raw allocation — verify the result is null-checked',
    suggest: 'Check for allocation failure or use RAII containers.'
  },
  {
    id: 'unreal-tick-heavy',
    pattern: /::Tick\s*\(|virtual\s+void\s+Tick\s*\(/,
    extensions: ['.cpp', '.h'],
    severity: 'low',
    category: 'performance',
    message: 'Tick override — confirm heavy work is not done every frame',
    suggest: 'Use timers or event-driven updates where possible.'
  },

  // --- GDScript ---
  {
    id: 'godot-get-node-process',
    pattern: /func\s+_process\s*\(|func\s+_physics_process\s*\(/,
    extensions: ['.gd'],
    severity: 'low',
    category: 'performance',
    message: '_process loop present — verify no get_node()/find_node() per frame',
    suggest: 'Cache node references with @onready.'
  },
  {
    id: 'godot-unsafe-get-node',
    pattern: /get_node\(["'][^"']+["']\)\.(?!connect)/,
    extensions: ['.gd'],
    severity: 'medium',
    category: 'crash',
    message: 'Chained call on get_node() — crashes with "null instance" if the path breaks',
    suggest: 'Use get_node_or_null() and check, or @onready with an assert.'
  },

  // --- JS/TS web games ---
  {
    id: 'js-empty-catch',
    pattern: /catch\s*(\([^)]*\))?\s*\{\s*\}/,
    extensions: ['.js', '.ts', '.jsx', '.tsx'],
    severity: 'high',
    category: 'crash',
    message: 'Empty catch block — errors vanish silently',
    suggest: 'Log and surface the error.'
  },
  {
    id: 'js-floating-promise',
    pattern: /^\s*(?!return|await|void|=|.*=\s*)[A-Za-z_$][\w.$]*\.(then|catch)\(\s*\)/,
    extensions: ['.js', '.ts'],
    severity: 'medium',
    category: 'crash',
    message: 'Promise chain with empty handler — rejection may be unhandled',
    suggest: 'Handle rejections explicitly.'
  },
  {
    id: 'js-localstorage-parse',
    pattern: /JSON\.parse\(\s*(localStorage|sessionStorage)\.getItem/,
    extensions: ['.js', '.ts', '.jsx', '.tsx'],
    severity: 'high',
    category: 'save-system',
    message: 'JSON.parse on raw storage value — throws on first run (null) or corrupted saves',
    suggest: 'Guard with a null check and try/catch, with a save-migration fallback.'
  },
  {
    id: 'js-settimeout-gameloop',
    pattern: /setInterval\(\s*[^,]+,\s*(?:1000\s*\/\s*60|16|17)\s*\)/,
    extensions: ['.js', '.ts'],
    severity: 'medium',
    category: 'performance',
    message: 'setInterval-based game loop — drifts and stutters vs requestAnimationFrame',
    suggest: 'Use requestAnimationFrame with delta time.'
  },

  // --- secrets (privacy) ---
  {
    id: 'hardcoded-secret',
    pattern: /(api[_-]?key|secret|password|token)\s*[:=]\s*["'][A-Za-z0-9\-_./+]{12,}["']/i,
    extensions: null,
    severity: 'critical',
    category: 'build',
    message: 'Possible hardcoded secret/credential in source',
    suggest: 'Move it to environment variables and rotate the key.'
  }
];

/** File-level heuristics that need whole-file context. */
export const FILE_RULES = [
  {
    id: 'huge-source-file',
    check: (content, file) => {
      const lines = content.split('\n').length;
      return lines > 1500 ? { line: 1, detail: `${lines} lines` } : null;
    },
    severity: 'low',
    category: 'gameplay',
    message: 'Very large source file — high-change-rate god files correlate with regressions',
    suggest: 'Split responsibilities into smaller modules.'
  },
  {
    id: 'save-system-no-error-handling',
    check: (content, file) => {
      const touchesSave = /(SaveGame|save_file|localStorage\.setItem|WriteAllText|FileAccess\.open|fopen|serialize)/i.test(content);
      const hasHandling = /try\s*[{:]|catch|except|Result<|\.is_ok\(\)|err\s*!?=/i.test(content);
      return touchesSave && !hasHandling ? { line: 1, detail: 'save/write logic without any error handling' } : null;
    },
    severity: 'high',
    category: 'save-system',
    message: 'Save/persistence code without error handling — corrupted saves will crash or wipe progress',
    suggest: 'Wrap disk I/O in error handling and validate loaded data.'
  }
];

/** Compile a custom rule from ember.config.json into the LINE_RULES shape. */
export function compileCustomRule(rule) {
  return {
    id: `custom:${rule.id}`,
    pattern: new RegExp(rule.pattern, rule.flags ?? ''),
    extensions: rule.extensions ?? null,
    severity: rule.severity ?? 'medium',
    category: rule.category ?? 'gameplay',
    message: rule.message ?? `Custom rule ${rule.id} matched`,
    suggest: rule.suggest ?? ''
  };
}
