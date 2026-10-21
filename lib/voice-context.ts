/**
 * Brand & Voice (core 079) for the app's drafters — server only.
 *
 * Every model draft to a prospect goes through `draftInVoice`: the sender's writing context (brand, the list's
 * product, team rules, the sender's OWN learned rules, highly rated examples) goes in front of the prompt, the draft
 * is checked by the kernel (never-write phrases, language, du/Sie, word cap), redrafted ONCE if it breaks a check,
 * and returned with a `voice` stamp. The UI keeps the stamp and sends it back when the person files the draft, so
 * the kernel stores the model's text next to the person's final text — that pair (plus the 1–10 rating) is what the
 * voice learns from. One implementation of the checks: the kernel's policy/voice.py.
 */
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { MODEL } from '@/lib/llm';
import { createMessage } from '@/lib/llm-usage';
import type { VoiceFlag, VoiceStamp, VoiceStep } from '@/lib/voice';

interface WritingContext {
  context?: string;
  rule_ids?: string[];
  error?: string;
}

export async function getVoiceContext(
  args: { prospectId?: string | null; icpId?: string | null; channel?: string; step?: VoiceStep },
  userId: string,
): Promise<WritingContext> {
  try {
    const out = await kernelCall('crm_voice_context', {
      ...(args.prospectId ? { prospect_id: args.prospectId } : {}),
      ...(args.icpId ? { icp_id: args.icpId } : {}),
      ...(args.channel ? { channel: args.channel } : {}),
      ...(args.step ? { step: args.step } : {}),
    }, userId);
    return out as WritingContext;
  } catch {
    return {}; // the voice must never stop a draft
  }
}

export function voiceBlock(ctx: WritingContext): string {
  return ctx.context ? `\n\nHOW WE WRITE (obey this; the sender's own rules win over everything above):\n${ctx.context}` : '';
}

async function checkDraft(text: string, args: { prospectId?: string | null; icpId?: string | null; channel: string; step: VoiceStep },
  userId: string): Promise<VoiceFlag[]> {
  try {
    const out = await kernelCall('crm_voice_check', {
      text, channel: args.channel, step: args.step,
      ...(args.prospectId ? { prospect_id: args.prospectId } : {}), ...(args.icpId ? { icp_id: args.icpId } : {}),
    }, userId) as { flags?: VoiceFlag[] };
    return Array.isArray(out.flags) ? out.flags : [];
  } catch {
    return [];
  }
}

async function generate(prompt: string, feature: string, userId: string, maxTokens: number): Promise<string> {
  const res = await createMessage({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
    { feature, userId });
  return res.content.map((b) => ('text' in b ? b.text : '')).join('').trim();
}

/** Draft one message in the sender's voice. Returns the text, the stamp to file it with, and any remaining flags. */
export async function draftInVoice(opts: {
  prompt: string; feature: string; userId: string; prospectId?: string | null; icpId?: string | null;
  channel: 'linkedin' | 'email'; step: VoiceStep; maxTokens?: number;
}): Promise<{ message: string; voice: VoiceStamp; flags: VoiceFlag[] } | { error: string }> {
  const where = { prospectId: opts.prospectId, icpId: opts.icpId, channel: opts.channel, step: opts.step };
  const ctx = await getVoiceContext(where, opts.userId);
  const maxTokens = opts.maxTokens ?? 500;
  let text = await generate(opts.prompt + voiceBlock(ctx), opts.feature, opts.userId, maxTokens);
  if (!text) return { error: 'The model returned no draft — write it yourself or try again.' };
  let flags = await checkDraft(text, where, opts.userId);
  if (flags.length > 0) {
    const retry = await generate(
      `${opts.prompt}${voiceBlock(ctx)}\n\nYour previous draft broke these rules: ${flags.map((f) => f.detail).join('; ')}.\n`
      + `Previous draft:\n"""\n${text}\n"""\nRewrite it so it obeys every rule. Return only the message.`,
      opts.feature, opts.userId, maxTokens);
    if (retry) {
      const again = await checkDraft(retry, where, opts.userId);
      if (again.length <= flags.length) { text = retry; flags = again; }
    }
  }
  return { message: text, flags, voice: { draft_original: text, drafted_by: opts.feature, voice_rule_ids: ctx.rule_ids ?? [] } };
}

/** A stamp for text that came from a template, not the model (an edit of it is still worth learning from). */
export function templateStamp(text: string, draftedBy: string): VoiceStamp {
  return { draft_original: text, drafted_by: draftedBy, voice_rule_ids: [] };
}

/** Accept a stamp the browser sends back — only the three known fields, bounded. */
export function cleanStamp(raw: unknown): VoiceStamp | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const original = typeof r.draft_original === 'string' ? r.draft_original.slice(0, 6000) : '';
  if (!original.trim()) return undefined;
  const ids = Array.isArray(r.voice_rule_ids)
    ? r.voice_rule_ids.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 80) : [];
  return { draft_original: original, drafted_by: typeof r.drafted_by === 'string' ? r.drafted_by.slice(0, 60) : 'app', voice_rule_ids: ids };
}
