/**
 * Centralized LLM configuration: one client + one model for every Claude call.
 *
 * Gemini is the DEFAULT (Amir, 2026-10-16: "Gemini the default, Bedrock a fallback"):
 * when GEMINI_API_KEY is set, `createMessage` (lib/llm-usage.ts) calls Gemini through
 * the adapter in lib/gemini.ts and falls back to the Claude path below on any failure
 * (HTTP error, timeout, empty answer). `MODEL` is the Gemini id then; the fallback id
 * is `BEDROCK_MODEL`. Without the key everything behaves as before.
 *
 * Two Claude providers, selected automatically by environment:
 *
 * - **Bedrock (bearer token)** — active when AWS_BEARER_TOKEN_BEDROCK is set.
 *   Uses Bedrock's InvokeModel endpoint, which serves the native Anthropic
 *   Messages format for Claude models (verified: full tool_use round trip).
 *   The stock @anthropic-ai/sdk client is kept; a custom fetch rewrites the
 *   request to `bedrock-runtime.{region}.amazonaws.com/model/{model}/invoke`
 *   with `Authorization: Bearer` and the `anthropic_version` body field.
 *   Model: us.anthropic.claude-sonnet-4-6 (cross-region inference profile).
 *
 * - **Anthropic API (legacy)** — fallback when no Bedrock token is present.
 *   Requires ANTHROPIC_API_KEY. Model: claude-opus-4-6.
 *
 * Notes:
 * - Bedrock does NOT support Anthropic's hosted web_search server tool, so
 *   `webSearchTools` is empty there — call sites spread it into their tools
 *   array and simply lose live search until the Hermes runtime owns research.
 * - All call sites are non-streaming (verified), which is what InvokeModel's
 *   plain endpoint serves. Do not add `stream: true` on the Bedrock path.
 */

import Anthropic from '@anthropic-ai/sdk';

const BEDROCK_TOKEN = process.env.AWS_BEARER_TOKEN_BEDROCK;
const BEDROCK_REGION = process.env.AWS_REGION || 'us-east-1';

export const BEDROCK_ENABLED = Boolean(BEDROCK_TOKEN);

/** The Claude model: the fallback when Gemini fails, the primary when there is no Gemini key. */
export const BEDROCK_MODEL = BEDROCK_ENABLED
  ? 'us.anthropic.claude-sonnet-4-6'
  : 'claude-opus-4-6';

export const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
export const GEMINI_ENABLED = Boolean(GEMINI_API_KEY);
/** Thinking model: calls here are infrequent and quality matters more than the last second. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
/** Model per task (2026-10-18): deep drafting / research on the strong model, small helpers on Flash-Lite. */
export const GEMINI_STRONG_MODEL = process.env.GEMINI_STRONG_MODEL || 'gemini-4-argon';
export const GEMINI_LITE_MODEL = process.env.GEMINI_LITE_MODEL || 'gemini-3.1-flash-lite';
const STRONG_FEATURES = new Set(['intro_draft', 'followup_draft', 'icp_suggest', 'icp_optimize', 'account_research']);
const LITE_FEATURES = new Set(['translate', 'contact_style']);
/** The Gemini model for an app feature; unknown features use the main model. */
export function geminiModelFor(feature: string | undefined): string {
  if (feature && STRONG_FEATURES.has(feature)) return GEMINI_STRONG_MODEL;
  if (feature && LITE_FEATURES.has(feature)) return GEMINI_LITE_MODEL;
  return GEMINI_MODEL;
}

/** Primary model for every call in the app. Never hardcode an id at a call site. */
export const MODEL = GEMINI_ENABLED ? GEMINI_MODEL : BEDROCK_MODEL;

/**
 * Rewrites SDK requests (api.anthropic.com/v1/messages shaped) into Bedrock
 * InvokeModel calls. Request/response bodies are Anthropic Messages format on
 * both sides; only the transport differs (URL, auth header, anthropic_version).
 */
const bedrockFetch: typeof fetch = async (_url, init) => {
  const raw = typeof init?.body === 'string' ? init.body : '';
  const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  let model = String(body.model || BEDROCK_MODEL);
  if (model.startsWith('gemini')) model = BEDROCK_MODEL; // a Gemini id can never be a Bedrock model
  delete body.model;
  delete body.stream; // InvokeModel plain endpoint is non-streaming
  body.anthropic_version = 'bedrock-2023-05-31';

  return fetch(
    `https://bedrock-runtime.${BEDROCK_REGION}.amazonaws.com/model/${encodeURIComponent(model)}/invoke`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BEDROCK_TOKEN}`,
      },
      body: JSON.stringify(body),
    }
  );
};

/** The one shared client. Import this — never `new Anthropic()` in call sites. */
export const anthropic = BEDROCK_ENABLED
  ? new Anthropic({ apiKey: 'bedrock-bearer-auth', fetch: bedrockFetch })
  : new Anthropic();

/**
 * Anthropic's hosted Web Search server tool (legacy shape, kept for reference).
 * Not available on Bedrock — use `webSearchTools` (spread) at call sites.
 */
export const webSearchTool = {
  type: 'web_search_20260209' as const,
  name: 'web_search' as const,
  max_uses: 5,
};

/**
 * Spread into `tools`: `[...TOOLS, ...webSearchTools]`. On Gemini it becomes Google Search
 * grounding (lib/gemini.ts); the Bedrock fallback strips it (Bedrock has no hosted search),
 * and on Bedrock alone it stays empty.
 */
export const webSearchTools = GEMINI_ENABLED || !BEDROCK_ENABLED ? [webSearchTool] : [];
