/**
 * The app's drafting client — server only. Since core 098 there is ONE drafter (salesbrain-hermes/drafter.py):
 * every message to a person is written there, in the SENDER's own measured voice, with their own messages as
 * examples, their priorities, the brand context, the person's facts and the playbook step. The app never builds a
 * prompt any more; it says what the message is (situation, channel, who) and what it must do (angle).
 *
 * The returned `voice` stamp goes back to the kernel when the person files the draft, so their edit, an untouched
 * send and the chip they tap all tie to exactly what the model wrote.
 */
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import type { VoiceFlag, VoiceStamp, VoiceStep } from '@/lib/voice';

export interface DraftRequest {
  situation: VoiceStep;
  channel: 'linkedin' | 'email' | 'whatsapp';
  userId: string;                 // who asks (the kernel takes the prospect's owner as the sender)
  feature?: string;               // the cost-ledger label (kept on the stamp as drafted_by)
  prospectId?: string | null;
  personId?: string | null;
  angle?: string | null;          // what this message must do, in one line
  goal?: string | null;
  previousText?: string | null;
  linkedinThreadId?: string | null;
  touchNumber?: number | null;
  language?: 'de' | 'en' | null;
  subject?: boolean;
  tag?: 'reengage' | 'partner' | 'no' | null;   // a variant of the sender's own situation skeleton
  connector?: { name: string; role: string; evidence: string } | null;   // intro ask
  lead?: { name: string; title?: string | null; company?: string | null } | null;
}

export interface DraftResult {
  message: string; subject: string | null; reasoning: string | null; used_facts: string[]; blurb: string | null;
  voice: VoiceStamp; flags: VoiceFlag[]; linkedin_thread_id: string | null; sender_name: string | null;
  language: string | null; trust_level: string | null;
  priorities: { content: string; kind: string }[];   // the sender's ranked rules the model saw (the card's foldable list)
}

/** Draft one message in the sender's voice through the kernel's one drafter. */
export async function draftInVoice(req: DraftRequest): Promise<DraftResult | { error: string }> {
  const args: Record<string, unknown> = { situation: req.situation, channel: req.channel };
  const put = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== '') args[k] = v; };
  put('prospect_id', req.prospectId); put('person_id', req.personId); put('angle', req.angle); put('goal', req.goal);
  put('previous_text', req.previousText); put('linkedin_thread_id', req.linkedinThreadId);
  put('touch_number', req.touchNumber); put('language', req.language); put('subject', req.subject || undefined);
  put('connector', req.connector); put('lead', req.lead); put('tag', req.tag);
  let out: Record<string, unknown>;
  try {
    out = await kernelCall('crm_draft', args, req.userId) as Record<string, unknown>;
  } catch (err) {
    return { error: `The drafter did not answer: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (typeof out.error === 'string') return { error: out.error };
  const text = typeof out.text === 'string' ? out.text.trim() : '';
  if (!text) return { error: 'The model returned no draft — write it yourself or try again.' };
  const voice = cleanStamp(out.voice) ?? { draft_original: text, drafted_by: req.feature ?? 'app', voice_rule_ids: [] };
  if (req.feature && voice.drafted_by === 'drafter:chat') voice.drafted_by = req.feature;
  return {
    message: text,
    subject: typeof out.subject === 'string' ? out.subject : null,
    reasoning: typeof out.reasoning === 'string' ? out.reasoning : null,
    used_facts: Array.isArray(out.used_facts) ? out.used_facts.map(String) : [],
    blurb: typeof out.blurb === 'string' ? out.blurb : null,
    voice,
    flags: Array.isArray(out.flags) ? (out.flags as VoiceFlag[]) : [],
    linkedin_thread_id: typeof out.linkedin_thread_id === 'string' ? out.linkedin_thread_id : null,
    sender_name: typeof out.sender_name === 'string' ? out.sender_name : null,
    language: typeof out.language === 'string' ? out.language : null,
    trust_level: typeof out.trust_level === 'string' ? out.trust_level : null,
    priorities: Array.isArray(out.priorities)
      ? (out.priorities as { content?: unknown; kind?: unknown }[]).filter((p) => typeof p?.content === 'string')
          .map((p) => ({ content: String(p.content), kind: String(p.kind ?? 'rule') })) : [],
  };
}

/** A stamp for text that came from a template, not the model (an edit of it is still worth learning from). */
export function templateStamp(text: string, draftedBy: string): VoiceStamp {
  return { draft_original: text, drafted_by: draftedBy, voice_rule_ids: [] };
}

const UUID = /^[0-9a-f-]{36}$/i;

/** Accept a stamp the browser sends back — only the known fields, bounded. */
export function cleanStamp(raw: unknown): VoiceStamp | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const original = typeof r.draft_original === 'string' ? r.draft_original.slice(0, 6000) : '';
  if (!original.trim()) return undefined;
  const ids = (k: string) => (Array.isArray(r[k]) ? (r[k] as unknown[]).filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 80) : []);
  const out: VoiceStamp = {
    draft_original: original,
    drafted_by: typeof r.drafted_by === 'string' ? r.drafted_by.slice(0, 60) : 'app',
    voice_rule_ids: ids('voice_rule_ids'),
  };
  if (typeof r.draft_reasoning === 'string' && r.draft_reasoning.trim()) out.draft_reasoning = r.draft_reasoning.slice(0, 300);
  if (Array.isArray(r.draft_facts)) out.draft_facts = r.draft_facts.map((x) => String(x).slice(0, 60)).slice(0, 12);
  if (typeof r.draft_situation === 'string' && ['connect', 'first', 'followup', 'reply', 'intro'].includes(r.draft_situation)) out.draft_situation = r.draft_situation as VoiceStep;
  if (typeof r.sender_profile_version === 'number') out.sender_profile_version = r.sender_profile_version;
  const ex = ids('example_ids');
  if (ex.length) out.example_ids = ex;
  if (typeof r.trust_level_at_draft === 'string') out.trust_level_at_draft = r.trust_level_at_draft.slice(0, 20);
  return out;
}
