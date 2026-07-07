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
