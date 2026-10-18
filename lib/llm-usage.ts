/**
 * App-side LLM calls, accounted for. Server-only (imports `pg`).
 *
 * `createMessage` is `anthropic.messages.create` plus one line in the cost
 * ledger: the response's token usage is added to today's `llm_usage` bucket
 * (salesbrain-core migration 048) under `surface = 'app'` and the feature tag
 * the call site gives. Tokens are stored, never money — the kernel prices them
 * at read time (`cost_report`), so there is no price table in this repo.
 *
 * Recording never blocks or fails the request: it is not awaited and every
 * error is swallowed.
 */

import type Anthropic from '@anthropic-ai/sdk';
import pool from './db';
import { anthropic, BEDROCK_ENABLED, BEDROCK_MODEL, GEMINI_API_KEY, GEMINI_ENABLED, GEMINI_MODEL, geminiModelFor } from './llm';
import { geminiCreate } from './gemini';

export interface UsageTag {
  /** What the call is for, e.g. 'icp_suggest'. Shown on /admin/costs. */
  feature: string;
  /** The person the call was made for; omit when there is none. */
  userId?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Must match uq_llm_usage_bucket (migration 048) expression for expression.
const UPSERT = `
  INSERT INTO llm_usage
    (surface, feature, model, provider, owner_user_id,
     calls, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
  VALUES ('app', $1, $2, $3, $4, 1, $5, $6, $7, $8)
  ON CONFLICT (day, surface, feature, model,
               COALESCE(owner_user_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid),
               COALESCE(hermes_session_id, ''))
  DO UPDATE SET calls = llm_usage.calls + 1,
    input_tokens = llm_usage.input_tokens + EXCLUDED.input_tokens,
    output_tokens = llm_usage.output_tokens + EXCLUDED.output_tokens,
    cache_read_tokens = llm_usage.cache_read_tokens + EXCLUDED.cache_read_tokens,
    cache_write_tokens = llm_usage.cache_write_tokens + EXCLUDED.cache_write_tokens,
    last_at = now()`;

export function recordUsage(
  model: string,
  usage: Anthropic.Usage | null | undefined,
  tag: UsageTag,
  provider: string = BEDROCK_ENABLED ? 'bedrock' : 'anthropic'
): void {
  if (!usage) return;
  const tokens = [
    usage.input_tokens ?? 0,
    usage.output_tokens ?? 0,
    usage.cache_read_input_tokens ?? 0,
    usage.cache_creation_input_tokens ?? 0,
  ].map((n) => Math.max(0, Math.trunc(Number(n) || 0)));
  if (!tokens.some((n) => n > 0)) return;
  const owner = tag.userId && UUID.test(tag.userId) ? tag.userId : null;
  pool
    .query(UPSERT, [
      tag.feature.slice(0, 120),
      model.slice(0, 120),
      provider,
      owner,
      ...tokens,
    ])
    .catch(() => {
      /* the ledger must never fail the call it accounts for */
    });
}

/** Anthropic-only block fields (`thought_signature` is ours, carried for Gemini) must not reach Claude. */
function forClaude(params: Anthropic.MessageCreateParamsNonStreaming): Anthropic.MessageCreateParamsNonStreaming {
  const messages = params.messages.map((m) => {
    if (typeof m.content === 'string') return m;
    return {
      ...m,
      content: m.content.map((b) => {
        if ((b as { type: string }).type !== 'tool_use') return b;
        const { thought_signature: _drop, ...rest } = b as unknown as Record<string, unknown>;
        void _drop;
        return rest as unknown as typeof b;
      }),
    };
  });
  // Bedrock has no hosted web search; a call that only wanted it simply runs without.
  const tools = params.tools?.filter((t) => !String((t as { type?: string }).type ?? '').startsWith('web_search'));
  return { ...params, model: BEDROCK_MODEL, messages, ...(tools ? { tools } : {}) };
}

/**
 * One non-streaming model call that also records its usage. Gemini first (when the key is set),
 * then the Claude path on ANY Gemini failure: an HTTP error, a timeout, a blocked or empty answer.
 * The call sites never see which one answered, except through `response.model`.
 */
export async function createMessage(
  params: Anthropic.MessageCreateParamsNonStreaming,
  tag: UsageTag
): Promise<Anthropic.Message> {
  if (GEMINI_ENABLED) {
    try {
      const chosen = geminiModelFor(tag.feature);
      let response;
      try {
        response = await geminiCreate(params, { apiKey: GEMINI_API_KEY, model: chosen });
      } catch (err) {
        if (chosen === GEMINI_MODEL) throw err;
        // The strong / lite model failed: the main Gemini model next, Claude after that.
        console.warn(`[llm] ${chosen} failed for ${tag.feature} (${err instanceof Error ? err.message : 'error'}); trying ${GEMINI_MODEL}`);
        response = await geminiCreate(params, { apiKey: GEMINI_API_KEY, model: GEMINI_MODEL });
      }
      recordUsage(response.model, response.usage, tag, 'gemini');
      return response;
    } catch (err) {
      console.warn(`[llm] gemini failed for ${tag.feature} (${err instanceof Error ? err.message : 'error'}); falling back to Claude`);
    }
  }
  const fallback = GEMINI_ENABLED ? forClaude(params) : params;
  const response = await anthropic.messages.create(fallback);
  recordUsage(String(fallback.model), response.usage, tag);
  return response;
}
