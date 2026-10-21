/**
 * Draft an intro request — server-only (imports the Anthropic client).
 *
 * The ask goes to the CONNECTOR, not the lead, and follows the double-opt-in
 * convention: a short personal note plus a forwardable blurb the connector can
 * paste to the lead as-is. Nothing is saved here; the user edits, then proposes.
 */
import { MODEL } from '@/lib/llm';
import { createMessage } from '@/lib/llm-usage';
import type { VoiceStamp } from '@/lib/voice';

export interface IntroDraftInput {
  owner_name: string;
  connector: { name: string; role: string; evidence: string; why?: string | null; channel?: string | null };
  lead: { name: string; title?: string | null; company?: string | null; research_summary?: string | null;
          qualification_reason?: string | null };
  product?: string | null;
  user_id?: string;   // who asked — labels the spend in the cost ledger
  voice?: { context?: string; rule_ids?: string[] };  // Brand & Voice writing context (079)
}
export interface IntroDraft { subject: string; message: string; forwardable_blurb: string; note?: string; voice?: VoiceStamp }

function extractJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
}

export async function draftIntroRequest(input: IntroDraftInput): Promise<IntroDraft | { error: string }> {
  const c = input.connector;
  const l = input.lead;
  const prompt = `You write short, warm introduction requests for B2B sales. Write in the first person as ${input.owner_name}.

You are asking ${c.name} (${c.role === 'colleague' ? 'a teammate' : 'a contact'}) to introduce you to ${l.name}${l.title ? `, ${l.title}` : ''}${l.company ? ` at ${l.company}` : ''}.
How you know ${c.name}: ${c.evidence}${c.why ? ` (${c.why})` : ''}.
Channel: ${c.channel || 'unknown'} (keep it short if LinkedIn).
${input.product ? `What we sell: ${input.product}.` : ''}
${l.research_summary ? `About the lead's company: ${l.research_summary}` : ''}
${l.qualification_reason ? `Why this lead fits: ${l.qualification_reason}` : ''}

Rules: double opt-in — ask ${c.name} whether they'd be comfortable making the intro, give them an easy out, and include a separate 2–3 sentence blurb they can forward to ${l.name} verbatim. No hype, no jargon, no more than ~110 words in the message. Do not invent facts about either person; if the evidence is thin, keep the ask general.

Return ONLY JSON:
{"subject": "…", "message": "…", "forwardable_blurb": "…"}${input.voice?.context
    ? `\n\nHOW WE WRITE (obey this; the sender's own rules win):\n${input.voice.context}` : ''}`;
  try {
    const res = await createMessage({ model: MODEL, max_tokens: 800, messages: [{ role: 'user', content: prompt }] },
      { feature: 'intro_draft', userId: input.user_id });
    const text = res.content.filter((x) => x.type === 'text').map((x) => (x as { text: string }).text).join('\n');
    const raw = extractJson(text);
    if (!raw || typeof raw.message !== 'string') return { error: 'The model returned no usable draft — try again.' };
    const message = String(raw.message).trim();
    const blurb = String(raw.forwardable_blurb || '').trim();
    return {
      subject: String(raw.subject || `Intro to ${l.name}?`).slice(0, 140),
      message,
      forwardable_blurb: blurb,
      note: 'Nothing was saved. Edit, then propose — the ask still needs your approval before it is sent.',
      // The filed text is message + the forwardable block (crm_propose_intro joins them the same way), so the
      // stamp is too: an untouched draft must not look edited.
      voice: { draft_original: blurb ? `${message}\n\n--- forwardable ---\n${blurb}` : message,
               drafted_by: 'intro_draft', voice_rule_ids: input.voice?.rule_ids ?? [] },
    };
  } catch (err) {
    return { error: `Model call failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
