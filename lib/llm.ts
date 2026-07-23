/**
 * Centralized LLM configuration: one client + one model for every Claude call.
 *
 * Two providers, selected automatically by environment:
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

/** Primary model for every Claude call in the app. */
export const MODEL = BEDROCK_ENABLED
  ? 'us.anthropic.claude-sonnet-4-6'
  : 'claude-opus-4-6';

/**
 * Rewrites SDK requests (api.anthropic.com/v1/messages shaped) into Bedrock
 * InvokeModel calls. Request/response bodies are Anthropic Messages format on
 * both sides; only the transport differs (URL, auth header, anthropic_version).
 */
const bedrockFetch: typeof fetch = async (_url, init) => {
  const raw = typeof init?.body === 'string' ? init.body : '';
  const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  const model = String(body.model || MODEL);
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

/** Spread into `tools`: `[...TOOLS, ...webSearchTools]`. Empty on Bedrock. */
export const webSearchTools = BEDROCK_ENABLED ? [] : [webSearchTool];
