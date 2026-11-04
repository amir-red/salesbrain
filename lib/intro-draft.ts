/**
 * Draft an intro request — server-only. Since core 098 the words come from the ONE drafter (situation `intro`):
 * the ask goes to the CONNECTOR, in the sender's own voice, with a forwardable blurb the connector can paste to
 * the lead as is (double opt-in). Nothing is saved here; the user edits, then proposes.
 */
import { draftInVoice } from '@/lib/voice-context';
import type { VoiceStamp } from '@/lib/voice';

export interface IntroDraftInput {
  owner_name: string;
  connector: { name: string; role: string; evidence: string; why?: string | null; channel?: string | null };
  lead: { name: string; title?: string | null; company?: string | null; research_summary?: string | null;
          qualification_reason?: string | null };
  prospect_id?: string | null;
  product?: string | null;
  user_id: string;   // who asked — labels the spend in the cost ledger
}
export interface IntroDraft { subject: string; message: string; forwardable_blurb: string; note?: string; voice?: VoiceStamp }

export async function draftIntroRequest(input: IntroDraftInput): Promise<IntroDraft | { error: string }> {
  const c = input.connector;
  const l = input.lead;
  const out = await draftInVoice({
    situation: 'intro', channel: c.channel === 'email' ? 'email' : 'linkedin', userId: input.user_id, feature: 'intro_draft',
    prospectId: input.prospect_id ?? null, subject: c.channel === 'email',
    angle: `Ask ${c.name} whether they would be comfortable introducing me to ${l.name}; give them an easy out.`
      + (c.why ? ` How we know each other: ${c.why}.` : ''),
    connector: { name: c.name, role: c.role === 'colleague' ? 'a teammate' : 'a contact', evidence: c.evidence },
    lead: { name: l.name, title: l.title, company: l.company },
  });
  if ('error' in out) return { error: out.error };
  const message = out.message;
  const blurb = (out.blurb || '').trim();
  return {
    subject: (out.subject || `Intro to ${l.name}?`).slice(0, 140),
    message,
    forwardable_blurb: blurb,
    note: 'Nothing was saved. Edit, then propose — the ask still needs your approval before it is sent.',
    // The filed text is message + the forwardable block (crm_propose_intro joins them the same way), so the
    // stamp is too: an untouched draft must not look edited.
    voice: { ...out.voice, draft_original: blurb ? `${message}\n\n--- forwardable ---\n${blurb}` : message, drafted_by: 'intro_draft' },
  };
}
