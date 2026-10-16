/**
 * Gemini adapter for the app's one-shot model calls. Server-only (reads the API key).
 *
 * Every call site speaks the Anthropic Messages shape (`createMessage` in
 * `lib/llm-usage.ts`). Gemini is the DEFAULT model since 2026-10-16 (Amir:
 * "Gemini the default, Bedrock a fallback"), so this file translates that shape
 * to Gemini's `generateContent` and back; the call sites did not change.
 *
 * Things that are different on Gemini and handled here, each learned from a live
 * test on 2026-10-16:
 *  - Thinking models spend their reasoning against `maxOutputTokens` and the 3.x
 *    Pro model cannot turn thinking off, so the budget gets headroom and an answer
 *    that comes back EMPTY is a failure (the caller then falls back to Bedrock).
 *  - Gemini 3 REQUIRES the `thoughtSignature` that came with a function call to be
 *    sent back with it. It is carried on the tool_use block (`thought_signature`)
 *    and echoed on the next turn; a call that did not come from Gemini (a Claude
 *    turn replayed after a fallback) gets Google's documented bypass value.
 *  - Gemini rejects JSON-schema keywords it does not know and empty enum values;
 *    `sanitizeSchema` keeps only the subset it accepts.
 *  - Anthropic's hosted `web_search` server tool maps to Gemini's `googleSearch`.
 * Never throws for a bad answer into a caller: it throws `GeminiError`, and
 * `createMessage` turns that into the Bedrock fallback.
 */

import type Anthropic from '@anthropic-ai/sdk';

export class GeminiError extends Error {}

/** Gemini's documented value for a function call that did not originate from Gemini. */
const SKIP_SIGNATURE = 'skip_thought_signature_validator';
/** Reasoning tokens count against maxOutputTokens; leave room for them. */
const THINKING_HEADROOM = 4096;

type Json = Record<string, unknown>;

const SCHEMA_KEYS = new Set([
  'type', 'description', 'enum', 'properties', 'required', 'items', 'nullable', 'format',
  'minimum', 'maximum', 'minItems', 'maxItems',
]);

/** The subset of JSON-schema Gemini accepts; everything else is dropped, not guessed. */
export function sanitizeSchema(schema: unknown): Json {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { type: 'object', properties: {} };
  const src = schema as Json;
  const out: Json = {};
  for (const [key, value] of Object.entries(src)) {
    if (!SCHEMA_KEYS.has(key)) continue;
    if (key === 'type' && Array.isArray(value)) {
      const kinds = value.filter((t) => t !== 'null');
      out.type = String(kinds[0] ?? 'string');
      if (value.includes('null')) out.nullable = true;
    } else if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, sanitizeSchema(v)]));
    } else if (key === 'items') {
      out.items = sanitizeSchema(value);
    } else if (key === 'enum' && Array.isArray(value)) {
      const vals = value.filter((v) => typeof v === 'string' && v !== '');
      if (vals.length) { out.enum = vals; out.type = 'string'; }
    } else {
      out[key] = value;
    }
  }
  if (out.type === 'object' && !out.properties) out.properties = {};
  return out;
}

function textOf(system: Anthropic.MessageCreateParams['system']): string {
  if (!system) return '';
  if (typeof system === 'string') return system;
  return system.map((b) => ('text' in b ? b.text : '')).join('\n');
}

type Part = Json;

function blocksToParts(content: string | Anthropic.ContentBlockParam[], toolNames: Map<string, string>): Part[] {
  if (typeof content === 'string') return content ? [{ text: content }] : [];
  const parts: Part[] = [];
  for (const raw of content) {
    const b = raw as unknown as Json & { type: string };
    if (b.type === 'text') {
      if (b.text) parts.push({ text: String(b.text) });
    } else if (b.type === 'image' || b.type === 'document') {
      const src = b.source as Json | undefined;
      if (src?.type === 'base64') parts.push({ inlineData: { mimeType: String(src.media_type), data: String(src.data) } });
    } else if (b.type === 'tool_use') {
      toolNames.set(String(b.id), String(b.name));
      parts.push({
        functionCall: { name: String(b.name), args: (b.input as Json) ?? {} },
        thoughtSignature: typeof b.thought_signature === 'string' ? b.thought_signature : SKIP_SIGNATURE,
      });
    } else if (b.type === 'tool_result') {
      const c = b.content;
      const text = typeof c === 'string' ? c
        : Array.isArray(c) ? c.map((x) => (x && typeof x === 'object' && 'text' in x ? String((x as Json).text) : '')).join('\n')
        : '';
      parts.push({
        functionResponse: {
          name: toolNames.get(String(b.tool_use_id)) ?? 'tool',
          response: b.is_error ? { error: text } : { result: text },
        },
      });
    }
  }
  return parts;
}

export function toGeminiBody(params: Anthropic.MessageCreateParams): Json {
  const toolNames = new Map<string, string>();
  const contents = params.messages
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: blocksToParts(m.content, toolNames) }))
    .filter((c) => c.parts.length);

  const declarations: Json[] = [];
  let grounding = false;
  for (const t of (params.tools ?? []) as unknown as Array<Json>) {
    const type = String(t.type ?? 'custom');
    if (type.startsWith('web_search')) { grounding = true; continue; }
    if (type !== 'custom' && t.input_schema === undefined) continue; // some other hosted tool: not on Gemini
    declarations.push({ name: t.name, description: t.description ?? '', parameters: sanitizeSchema(t.input_schema) });
  }
  const tools: Json[] = [];
  if (declarations.length) tools.push({ functionDeclarations: declarations });
  // Gemini does not mix hosted search with function declarations in one request.
  else if (grounding) tools.push({ googleSearch: {} });

  const system = textOf(params.system);
  return {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    ...(tools.length ? { tools } : {}),
    generationConfig: {
      maxOutputTokens: (params.max_tokens ?? 1024) + THINKING_HEADROOM,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      thinkingConfig: { thinkingLevel: 'low' },
    },
  };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Json[] }; finishReason?: string }>;
  usageMetadata?: Record<string, number>;
  modelVersion?: string;
  promptFeedback?: { blockReason?: string };
}

export function fromGeminiResponse(json: GeminiResponse, model: string): Anthropic.Message {
  const cand = json.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  const content: Array<Json> = [];
  let calls = 0;
  for (const p of parts) {
    if (p.thought) continue; // reasoning summaries are not an answer
    if (typeof p.text === 'string' && p.text) {
      content.push({ type: 'text', text: p.text });
    } else if (p.functionCall) {
      const fc = p.functionCall as Json;
      calls++;
      content.push({
        type: 'tool_use',
        id: `toolu_gem_${Date.now().toString(36)}_${calls}`,
        name: String(fc.name),
        input: (fc.args as Json) ?? {},
        ...(typeof p.thoughtSignature === 'string' ? { thought_signature: p.thoughtSignature } : {}),
      });
    }
  }
  if (!content.length) {
    throw new GeminiError(
      json.promptFeedback?.blockReason ? `blocked: ${json.promptFeedback.blockReason}`
        : `empty answer (finishReason ${cand?.finishReason ?? 'none'})`);
  }
  const u = json.usageMetadata ?? {};
  const cached = u.cachedContentTokenCount ?? 0;
  const finish = cand?.finishReason;
  return {
    id: `msg_gem_${Date.now().toString(36)}`,
    type: 'message',
    role: 'assistant',
    model: json.modelVersion || model,
    content,
    stop_reason: calls ? 'tool_use' : finish === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn',
    stop_sequence: null,
    usage: {
      // Gemini's promptTokenCount includes cached tokens; the ledger stores them apart.
      input_tokens: Math.max(0, (u.promptTokenCount ?? 0) - cached),
      // Reasoning is billed as output.
      output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

export async function geminiCreate(
  params: Anthropic.MessageCreateParamsNonStreaming,
  opts: { apiKey: string; model: string; timeoutMs?: number }
): Promise<Anthropic.Message> {
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: JSON.stringify(toGeminiBody(params)),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
    });
  } catch (err) {
    throw new GeminiError(`request failed: ${err instanceof Error ? err.name : 'error'}`);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = String(((await res.json()) as { error?: { message?: string } }).error?.message ?? '').slice(0, 200); } catch { /* ignore */ }
    throw new GeminiError(`HTTP ${res.status} ${detail}`.trim());
  }
  return fromGeminiResponse((await res.json()) as GeminiResponse, opts.model);
}
