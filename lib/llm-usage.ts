/**
 * App-side LLM calls, accounted for. Server-only (imports `pg`).
 *
 * `createMessage` is `anthropic.messages.create` plus one line in the cost
 * ledger: the response's token usage is added to today's `llm_usage` bucket
 * (salesbrain-core migration 048) under `surface = 'app'` and the feature tag
 * the call site gives. Tokens are stored, never money — the kernel prices them
 * at read time (`crm_cost_report`), so there is no price table in this repo.
 *
 * Recording never blocks or fails the request: it is not awaited and every
 * error is swallowed.
 */

import type Anthropic from '@anthropic-ai/sdk';
import pool from './db';
import { anthropic, BEDROCK_ENABLED } from './llm';

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

export function recordUsage(model: string, usage: Anthropic.Usage | null | undefined, tag: UsageTag): void {
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
      BEDROCK_ENABLED ? 'bedrock' : 'anthropic',
      owner,
      ...tokens,
    ])
    .catch(() => {
      /* the ledger must never fail the call it accounts for */
    });
}

/** `anthropic.messages.create` (non-streaming) that also records its usage. */
export async function createMessage(
  params: Anthropic.MessageCreateParamsNonStreaming,
  tag: UsageTag
): Promise<Anthropic.Message> {
  const response = await anthropic.messages.create(params);
  recordUsage(String(params.model), response.usage, tag);
  return response;
}
