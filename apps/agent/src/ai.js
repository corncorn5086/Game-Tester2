/**
 * Optional AI layer — bug explanations and report executive summaries.
 * Local-first: every agent command works without it. Supports two providers,
 * selected explicitly or auto-resolved from whichever API key is present
 * (Claude preferred when both are configured and no provider is requested).
 */
const CLAUDE_MODEL = 'claude-fable-5';
const CLAUDE_FALLBACK_MODEL = 'claude-opus-4-8';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

import { maskSecrets } from './util.js';

const PROVIDER_LABEL = { claude: 'Claude Fable 5', openai: 'OpenAI' };
const PROVIDERS = ['claude', 'openai'];
const REQUEST_TIMEOUT_MS = 60_000;

function openaiModel() {
  return process.env.OPENAI_MODEL || 'gpt-5.6-terra';
}

function credentialFor(provider, credentials = null) {
  const supplied = credentials?.[provider];
  if (typeof supplied === 'string' && supplied.trim()) return supplied.trim();
  const environmentValue = provider === 'claude'
    ? process.env.ANTHROPIC_API_KEY
    : process.env.OPENAI_API_KEY;
  return typeof environmentValue === 'string' && environmentValue.trim()
    ? environmentValue.trim()
    : null;
}

function credentialSource(provider, credentials = null) {
  if (typeof credentials?.[provider] === 'string' && credentials[provider].trim()) return 'supplied';
  return credentialFor(provider) ? 'environment' : null;
}

/**
 * Providers with a usable API key, Claude first. CLI callers continue to use
 * environment variables; trusted hosts such as Ember Desktop may instead pass
 * credentials directly without ever mutating process.env.
 */
export function configuredProviders(credentials = null) {
  const list = [];
  if (credentialFor('claude', credentials)) list.push('claude');
  if (credentialFor('openai', credentials)) list.push('openai');
  return list;
}

/** Order of providers to try: an explicit choice is tried alone; "auto" tries every configured provider in turn. */
function resolveOrder(preferred, credentials = null) {
  const configured = configuredProviders(credentials);
  if (preferred === 'claude' || preferred === 'openai') return configured.includes(preferred) ? [preferred] : [];
  return configured;
}

export function aiConfigured(credentials = null) {
  return configuredProviders(credentials).length > 0;
}

export function aiStatus(preferred, { credentials = null, verifiedProviders = [] } = {}) {
  const configured = configuredProviders(credentials);
  const order = resolveOrder(preferred, credentials);
  const verified = new Set(Array.isArray(verifiedProviders) ? verifiedProviders : []);
  const providers = PROVIDERS.map((provider) => ({
    id: provider,
    label: PROVIDER_LABEL[provider],
    model: provider === 'claude' ? CLAUDE_MODEL : openaiModel(),
    configured: configured.includes(provider),
    verified: configured.includes(provider) && verified.has(provider),
    source: credentialSource(provider, credentials)
  }));
  if (order.length === 0) {
    return {
      enabled: false,
      configured,
      verified: [],
      providers,
      provider: null,
      reason: 'Set ANTHROPIC_API_KEY and/or OPENAI_API_KEY in .env to enable AI bug explanations and report summaries.'
    };
  }
  const [provider, ...fallback] = order;
  return {
    enabled: true,
    configured,
    verified: configured.filter((id) => verified.has(id)),
    providers,
    provider,
    label: PROVIDER_LABEL[provider],
    model: provider === 'claude' ? CLAUDE_MODEL : openaiModel(),
    fallback // other configured providers tried automatically if `provider` fails, only when preferred is unset/"auto"
  };
}

function requestSignal(signal) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  return signal;
}

function safeAIError(error, signal, credentials) {
  if (signal?.aborted) return { ok: false, cancelled: true, error: 'AI request cancelled.' };
  if (error?.name === 'TimeoutError') return { ok: false, timedOut: true, error: 'AI request timed out after 60 seconds.' };
  return {
    ok: false,
    error: `AI request failed: ${maskSecrets(error?.message || String(error), Object.values(credentials || {}))}`
  };
}

async function callClaude(prompt, { apiKey, maxTokens = 512, effort = 'medium', signal, credentials } = {}) {
  let res;
  try {
    res = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
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
      signal: requestSignal(signal)
    });
  } catch (e) {
    return safeAIError(e, signal, credentials);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      ok: false,
      error: maskSecrets(data?.error?.message ?? `Anthropic API error ${res.status}`, Object.values(credentials || {}))
    };
  }
  if (data.stop_reason === 'refusal') {
    return { ok: false, error: 'Claude declined to respond to this request.' };
  }
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!text) return { ok: false, error: 'Empty response from Claude.' };
  return {
    ok: true,
    text,
    provider: 'claude',
    model: data.model ?? CLAUDE_MODEL,
    requestId: typeof data.id === 'string' ? data.id : null
  };
}

async function callOpenAI(prompt, { apiKey, maxTokens = 512, effort = 'medium', signal, credentials } = {}) {
  const model = openaiModel();
  let res;
  try {
    res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        max_output_tokens: maxTokens,
        input: prompt,
        reasoning: { effort },
        store: false
      }),
      signal: requestSignal(signal)
    });
  } catch (e) {
    return safeAIError(e, signal, credentials);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      ok: false,
      error: maskSecrets(data?.error?.message ?? `OpenAI API error ${res.status}`, Object.values(credentials || {}))
    };
  }
  const refused = (data.output ?? []).some((item) =>
    (item.content ?? []).some((part) => part.type === 'refusal'));
  if (refused) return { ok: false, error: 'OpenAI declined to respond to this request (content filter).' };
  const text = (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('\n')
    .trim();
  if (!text) return { ok: false, error: 'Empty response from OpenAI.' };
  return {
    ok: true,
    text,
    provider: 'openai',
    model: typeof data.model === 'string' ? data.model : model,
    requestId: typeof data.id === 'string' ? data.id : null
  };
}

async function callAI(prompt, { maxTokens, effort, provider, credentials = null, signal } = {}) {
  const order = resolveOrder(provider, credentials);
  if (order.length === 0) {
    return { ok: false, error: 'No AI provider is configured — set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env.' };
  }
  const protectedPrompt = maskSecrets(prompt, [
    ...Object.values(credentials || {}),
    process.env.ANTHROPIC_API_KEY,
    process.env.OPENAI_API_KEY
  ]);
  let last = null;
  for (const p of order) {
    if (signal?.aborted) return { ok: false, cancelled: true, error: 'AI request cancelled.' };
    const apiKey = credentialFor(p, credentials);
    last = p === 'claude'
      ? await callClaude(protectedPrompt, { apiKey, maxTokens, effort, signal, credentials })
      : await callOpenAI(protectedPrompt, { apiKey, maxTokens, effort, signal, credentials });
    if (!last.provider) {
      last = {
        ...last,
        provider: p,
        model: p === 'claude' ? CLAUDE_MODEL : openaiModel()
      };
    }
    if (last.ok) return last;
    if (last.cancelled) return last;
  }
  return last;
}

/** Explain a single bug and suggest a concrete fix, grounded in its real evidence. */
export function explainBug(bug, { provider, credentials, signal } = {}) {
  const prompt = `You are a senior game QA engineer. Explain this bug concisely for another engineer and suggest a concrete fix. Reply in under 150 words: root cause hypothesis, then a concrete fix suggestion. Do not invent details not present below.

Bug: ${bug.title}
Severity: ${bug.severity} · Category: ${bug.category} · Source: ${bug.source}
Files: ${(bug.filesInvolved ?? []).join(', ') || 'none'}${bug.line ? ` (line ${bug.line})` : ''}
Evidence: ${bug.evidence}
Steps to reproduce:
${(bug.stepsToReproduce ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n') || 'none recorded'}`;
  return callAI(prompt, { maxTokens: 512, effort: 'medium', provider, credentials, signal });
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
export async function triageBug(bug, { provider, credentials, signal } = {}) {
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

  const res = await callAI(prompt, { maxTokens: 700, effort: 'medium', provider, credentials, signal });
  if (!res.ok) return res;

  const parsed = parseJsonResponse(res.text);
  if (!parsed.ok) {
    return {
      ok: false,
      error: 'AI response was not valid structured data — try again.',
      provider: res.provider,
      model: res.model,
      requestId: res.requestId ?? null
    };
  }
  const d = parsed.data;
  return {
    ok: true,
    provider: res.provider,
    model: res.model,
    requestId: res.requestId ?? null,
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
export function summarizeReport(report, { provider, credentials, signal } = {}) {
  const m = report.metrics;
  const prompt = `You are a senior QA lead writing an executive summary for a game studio's leadership. Write 3-5 sentences in a professional tone, using only the facts below — no invented scores, no speculation beyond what the data supports.

Project: ${report.project?.name} (${report.project?.engine})
Files scanned: ${m.filesScanned} · Logs analyzed: ${m.logsAnalyzed}
Bugs: ${m.bugsFound} (${m.severityBreakdown.critical} critical, ${m.severityBreakdown.high} high, ${m.severityBreakdown.medium} medium, ${m.severityBreakdown.low} low)
Crash risk: ${m.crashRisk} · Build health: ${m.buildHealth} · Regression risk: ${m.regressionRisk}
Blockers: ${(report.blockers ?? []).map((b) => b.message).join('; ') || 'none'}
Top bugs: ${(report.bugs ?? []).slice(0, 5).map((b) => b.title).join('; ') || 'none'}`;
  return callAI(prompt, { maxTokens: 400, effort: 'low', provider, credentials, signal });
}

/**
 * Make a minimal, real provider request. Desktop uses this to distinguish a
 * stored credential from one that has actually been accepted by the provider.
 */
export async function testAIConnection({ provider, credentials, signal } = {}) {
  const startedAt = Date.now();
  const result = await callAI(
    'Connection check for Ember QA. Reply with exactly: EMBER_OK',
    {
      maxTokens: 16,
      effort: provider === 'openai' ? 'none' : 'low',
      provider,
      credentials,
      signal
    }
  );
  const durationMs = Date.now() - startedAt;
  if (!result.ok) return { ...result, durationMs };
  if (typeof result.text !== 'string' || result.text.trim() !== 'EMBER_OK') {
    return {
      ok: false,
      provider: result.provider ?? null,
      model: result.model ?? null,
      requestId: result.requestId ?? null,
      error: 'AI provider readiness response was invalid.',
      durationMs
    };
  }
  return { ...result, durationMs };
}
