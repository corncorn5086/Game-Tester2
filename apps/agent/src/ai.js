/**
 * Optional AI layer — bug explanations and report executive summaries.
 * Local-first: every agent command works without it. Supports two providers,
 * selected explicitly or auto-resolved from whichever API key is present
 * (Claude preferred when both are configured and no provider is requested).
 */
const CLAUDE_MODEL = 'claude-fable-5';
const CLAUDE_FALLBACK_MODEL = 'claude-opus-4-8';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

const PROVIDER_LABEL = { claude: 'Claude Fable 5', openai: 'OpenAI' };

function openaiModel() {
  return process.env.OPENAI_MODEL || 'gpt-4o';
}

/** Providers with a usable API key in the environment, Claude first. */
export function configuredProviders() {
  const list = [];
  if (process.env.ANTHROPIC_API_KEY) list.push('claude');
  if (process.env.OPENAI_API_KEY) list.push('openai');
  return list;
}

/** Order of providers to try: an explicit choice is tried alone; "auto" tries every configured provider in turn. */
function resolveOrder(preferred) {
  const configured = configuredProviders();
  if (preferred === 'claude' || preferred === 'openai') return configured.includes(preferred) ? [preferred] : [];
  return configured;
}

export function aiConfigured() {
  return configuredProviders().length > 0;
}

export function aiStatus(preferred) {
  const configured = configuredProviders();
  const order = resolveOrder(preferred);
  if (order.length === 0) {
    return {
      enabled: false,
      configured,
      provider: null,
      reason: 'Set ANTHROPIC_API_KEY and/or OPENAI_API_KEY in .env to enable AI bug explanations and report summaries.'
    };
  }
  const [provider, ...fallback] = order;
  return {
    enabled: true,
    configured,
    provider,
    label: PROVIDER_LABEL[provider],
    model: provider === 'claude' ? CLAUDE_MODEL : openaiModel(),
    fallback // other configured providers tried automatically if `provider` fails, only when preferred is unset/"auto"
  };
}

async function callClaude(prompt, { maxTokens = 512, effort = 'medium' } = {}) {
  let res;
  try {
    res = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-06-01'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
        output_config: { effort },
        fallbacks: [{ model: CLAUDE_FALLBACK_MODEL }]
      }),
      signal: AbortSignal.timeout(60000)
    });
  } catch (e) {
    return { ok: false, error: `AI request failed: ${e.message}` };
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, error: data?.error?.message ?? `Anthropic API error ${res.status}` };
  }
  if (data.stop_reason === 'refusal') {
    return { ok: false, error: 'Claude declined to respond to this request.' };
  }
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!text) return { ok: false, error: 'Empty response from Claude.' };
  return { ok: true, text, provider: 'claude', model: data.model ?? CLAUDE_MODEL };
}

async function callOpenAI(prompt, { maxTokens = 512 } = {}) {
  const model = openaiModel();
  let res;
  try {
    res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(60000)
    });
  } catch (e) {
    return { ok: false, error: `AI request failed: ${e.message}` };
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, error: data?.error?.message ?? `OpenAI API error ${res.status}` };
  }
  const choice = data.choices?.[0];
  if (choice?.finish_reason === 'content_filter') {
    return { ok: false, error: 'OpenAI declined to respond to this request (content filter).' };
  }
  const text = choice?.message?.content?.trim();
  if (!text) return { ok: false, error: 'Empty response from OpenAI.' };
  return { ok: true, text, provider: 'openai', model };
}

async function callAI(prompt, { maxTokens, effort, provider } = {}) {
  const order = resolveOrder(provider);
  if (order.length === 0) {
    return { ok: false, error: 'No AI provider is configured — set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env.' };
  }
  let last = null;
  for (const p of order) {
    last = p === 'claude' ? await callClaude(prompt, { maxTokens, effort }) : await callOpenAI(prompt, { maxTokens });
    if (last.ok) return last;
  }
  return last;
}

/** Explain a single bug and suggest a concrete fix, grounded in its real evidence. */
export function explainBug(bug, { provider } = {}) {
  const prompt = `You are a senior game QA engineer. Explain this bug concisely for another engineer and suggest a concrete fix. Reply in under 150 words: root cause hypothesis, then a concrete fix suggestion. Do not invent details not present below.

Bug: ${bug.title}
Severity: ${bug.severity} · Category: ${bug.category} · Source: ${bug.source}
Files: ${(bug.filesInvolved ?? []).join(', ') || 'none'}${bug.line ? ` (line ${bug.line})` : ''}
Evidence: ${bug.evidence}
Steps to reproduce:
${(bug.stepsToReproduce ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n') || 'none recorded'}`;
  return callAI(prompt, { maxTokens: 512, effort: 'medium', provider });
}

function stripCodeFence(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : text).trim();
}

/** Parse a strict-JSON model response defensively — never guess at malformed output. */
function parseJsonResponse(text) {
  const cleaned = stripCodeFence(text);
  try {
    return { ok: true, data: JSON.parse(cleaned) };
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return { ok: true, data: JSON.parse(match[0]) }; } catch { /* fall through */ }
    }
    return { ok: false };
  }
}

/**
 * Full bug triage: root cause, fix, reproduction steps, a ready-to-send
 * message for a developer, and a priority score — all grounded strictly in
 * the bug's real evidence. If the evidence is too thin, the model is
 * instructed to say so explicitly (insufficientInfo) rather than invent
 * anything; a malformed AI response is reported as an error, never patched
 * over with guessed values.
 */
export async function triageBug(bug, { provider } = {}) {
  const prompt = `You are a senior QA triage assistant for a game studio. Using ONLY the evidence below, produce a structured triage. If the evidence is too thin to confidently determine the root cause or reproduction steps, set "insufficientInfo": true and explain what's missing in "insufficientReason" — never invent details that aren't supported by the evidence.

Respond with STRICT JSON only — no markdown fences, no prose outside the JSON — matching exactly this shape:
{
  "insufficientInfo": boolean,
  "insufficientReason": string or null,
  "rootCause": string,
  "fix": string,
  "reproSteps": string[],
  "priorityScore": number (0-100, higher = more urgent),
  "priorityLabel": "P0 - Blocker" | "P1 - Critical" | "P2 - High" | "P3 - Normal" | "P4 - Low",
  "devMessage": string (a short, ready-to-paste message for a developer — professional tone, references the file/line and evidence)
}

Bug: ${bug.title}
Severity: ${bug.severity} · Category: ${bug.category} · Source: ${bug.source}
Files: ${(bug.filesInvolved ?? []).join(', ') || 'none'}${bug.line ? ` (line ${bug.line})` : ''}
Evidence: ${bug.evidence}
Existing steps to reproduce: ${(bug.stepsToReproduce ?? []).join(' / ') || 'none recorded'}
Regression risk: ${bug.regressionRisk ?? 'unknown'} · Reproducibility confidence: ${bug.reproducibilityConfidence ?? 'unknown'}`;

  const res = await callAI(prompt, { maxTokens: 700, effort: 'medium', provider });
  if (!res.ok) return res;

  const parsed = parseJsonResponse(res.text);
  if (!parsed.ok) {
    return { ok: false, error: 'AI response was not valid structured data — try again.', provider: res.provider, model: res.model };
  }
  const d = parsed.data;
  return {
    ok: true,
    provider: res.provider,
    model: res.model,
    insufficientInfo: !!d.insufficientInfo,
    insufficientReason: d.insufficientReason ?? null,
    rootCause: d.rootCause ?? null,
    fix: d.fix ?? null,
    reproSteps: Array.isArray(d.reproSteps) ? d.reproSteps : [],
    priorityScore: typeof d.priorityScore === 'number' ? d.priorityScore : null,
    priorityLabel: d.priorityLabel ?? null,
    devMessage: d.devMessage ?? null
  };
}

/** Write a short executive summary for a QA report, grounded strictly in its metrics. */
export function summarizeReport(report, { provider } = {}) {
  const m = report.metrics;
  const prompt = `You are a senior QA lead writing an executive summary for a game studio's leadership. Write 3-5 sentences in a professional tone, using only the facts below — no invented scores, no speculation beyond what the data supports.

Project: ${report.project?.name} (${report.project?.engine})
Files scanned: ${m.filesScanned} · Logs analyzed: ${m.logsAnalyzed}
Bugs: ${m.bugsFound} (${m.severityBreakdown.critical} critical, ${m.severityBreakdown.high} high, ${m.severityBreakdown.medium} medium, ${m.severityBreakdown.low} low)
Crash risk: ${m.crashRisk} · Build health: ${m.buildHealth} · Regression risk: ${m.regressionRisk}
Blockers: ${(report.blockers ?? []).map((b) => b.message).join('; ') || 'none'}
Top bugs: ${(report.bugs ?? []).slice(0, 5).map((b) => b.title).join('; ') || 'none'}`;
  return callAI(prompt, { maxTokens: 400, effort: 'low', provider });
}
