/**
 * Outreach from the lead card — LinkedIn, through the lead's SENDER (the prospect's owner, whose
 * account the request or message goes out from). Nothing here sends: every action files an
 * approval the sender decides on (Telegram card or /agents), and the kernel's send gate consumes it.
 *
 *   GET  → { mode, sender, thread, pending, can_act, why }       what the card can do right now
 *   POST {action:'connect', note?}                                 file a connection request
 *   POST {action:'draft'}                                          a first message or the next message
 *                                                                  in the conversation; saves nothing
 *   POST {action:'propose', message, voice?}                       file that message for approval; `voice` is the
 *                                                                  stamp the draft came with (Brand & Voice, 079)
 *
 * mode: no_prospect · no_profile · no_sender (owner has no LinkedIn) · connect · request_pending ·
 *       first_message (connected, no conversation yet) · thread (a conversation exists)
 * Runs as the lead's owner for an admin (lib/act-as); anyone else only on their own leads.
 */
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { cleanStamp, draftInVoice, templateStamp } from '@/lib/voice-context';
import { resolveActingUser } from '@/lib/act-as';
import type { OutreachState } from '@/lib/sales-leads';
import { outreachFacts as facts, type OutreachFacts as Facts } from '@/lib/sales-lead-outreach';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const client = await pool.connect();
  try {
    const f = await facts(client, id, session.userId, session.role === 'admin');
    if (!f) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    const { mode, sender, thread, pending, can_act, why } = f;
    return NextResponse.json({ mode, sender, thread, pending, can_act, why } satisfies OutreachState);
  } finally {
    client.release();
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  let body: { action?: string; message?: string; note?: string; voice?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!['connect', 'draft', 'propose'].includes(body.action ?? '')) {
    return NextResponse.json({ error: "action must be 'connect' | 'draft' | 'propose'" }, { status: 400 });
  }

  const client = await pool.connect();
  let f: Facts | null;
  try { f = await facts(client, id, session.userId, session.role === 'admin'); } finally { client.release(); }
  if (!f) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  if (!f.prospect_id || !f.can_act) return NextResponse.json({ error: f.why ?? 'Not allowed' }, { status: 409 });
  const acting = await resolveActingUser(session, f.prospect_id, 'owner',
    body.action === 'connect' ? 'crm_linkedin_connect_propose' : 'lead_card_message', body.action !== 'draft');
  if ('error' in acting) return NextResponse.json({ error: acting.error }, { status: acting.status });
  const actedAs = { user_id: acting.actingUserId, name: acting.actingName, on_behalf: acting.onBehalf };

  try {
    if (body.action === 'connect') {
      if (!['connect'].includes(f.mode)) return NextResponse.json({ error: f.why ?? `Cannot send a request now (${f.mode.replace('_', ' ')}).` }, { status: 409 });
      const note = (body.note ?? '').trim().slice(0, 200);
      const out = await kernelCall('crm_linkedin_connect_propose', { prospect_id: f.prospect_id, ...(note ? { note } : {}) },
        acting.actingUserId) as Record<string, unknown>;
      return NextResponse.json({ ...out, acted_as: actedAs }, { status: out.error ? 400 : 200 });
    }

    if (f.mode !== 'first_message' && f.mode !== 'thread') {
      return NextResponse.json({ error: f.why ?? (f.mode === 'connect' || f.mode === 'request_pending'
        ? 'Not connected yet — a LinkedIn message can only go to a connection. Send a connection request first.'
        : 'Nothing can be sent to this lead yet.') }, { status: 409 });
    }

    if (body.action === 'draft') {
      const first = (f.full_name || '').trim().split(/\s+/)[0] ?? '';
      if (f.mode === 'first_message' && f.template) {
        const text = f.template.replaceAll('{first_name}', first).replaceAll('{full_name}', f.full_name)
          .replaceAll('{company}', f.company ?? '');
        return NextResponse.json({ message: text.trim(), source: 'template',
          voice: templateStamp(text.trim(), 'first_message_template') });
      }
      const convo = f.thread.map((m) => `${m.ours ? 'We' : 'They'}: ${(m.text ?? '').replace(/\s+/g, ' ').slice(0, 600)}`).join('\n');
      const lastFromThem = f.thread.length > 0 && !f.thread[f.thread.length - 1].ours;
      const points = Array.isArray((f.dossier as { talking_points?: unknown })?.talking_points)
        ? ((f.dossier as { talking_points: string[] }).talking_points).slice(0, 4).join('; ') : '';
      const task = f.mode === 'first_message'
        ? 'Write the FIRST LinkedIn message to this new connection: thank them briefly for connecting, one specific reason we are reaching out, one easy question.'
        : lastFromThem
          ? 'Write our REPLY to their last message: answer what they said first, then one clear next step.'
          : 'Write a short FOLLOW-UP: they have not answered our last message. One new useful thing, no apology for following up, one easy question.';
      const prompt = `You write short LinkedIn messages for B2B sales, in the first person as ${acting.actingName || 'me'}.

Recipient: ${f.full_name}${f.title ? `, ${f.title}` : ''}${f.company ? ` at ${f.company}` : ''}.
${task}
${convo ? `The conversation so far (oldest first):\n"""\n${convo}\n"""` : 'There is no conversation yet.'}
${f.product ? `What we offer: ${f.product}.` : ''}
${points ? `Talking points for this person: ${points}.` : ''}
${f.research ? `About their company: ${f.research.slice(0, 800)}` : ''}

Rules: write in the SAME language as the conversation; with no conversation, in German when the person or company is German-speaking (judge from the names and company), otherwise English. At most ~70 words. No subject line, no signature block beyond the first name. Do not invent facts, meetings or numbers. Plain text.`;
      const out = await draftInVoice({ prompt, feature: 'lead_card_draft', userId: acting.actingUserId,
        prospectId: f.prospect_id, channel: 'linkedin',
        step: f.mode === 'first_message' ? 'first' : lastFromThem ? 'reply' : 'followup' });
      if ('error' in out) return NextResponse.json({ error: out.error }, { status: 502 });
      return NextResponse.json({ ...out, source: 'model' });
    }

    // propose
    const message = (body.message ?? '').trim();
    if (!message) return NextResponse.json({ error: 'Write the message first.' }, { status: 400 });
    const voice = cleanStamp(body.voice);
    const out = f.mode === 'first_message'
      ? await kernelCall('crm_linkedin_first_message_propose', { prospect_id: f.prospect_id, text: message,
          ...(voice ? { voice } : {}) }, acting.actingUserId)
      : await kernelCall('crm_outreach_propose', {
          person_id: f.person_id, prospect_id: f.prospect_id, channel: 'linkedin', kind: 'followup',
          linkedin_thread_id: f.thread_id, message,
          rationale: 'Written on the /sales-leads card — the next message in this LinkedIn conversation.',
          ...(voice ? { voice } : {}),
        }, acting.actingUserId);
    const o = out as Record<string, unknown>;
    return NextResponse.json({ ...o, acted_as: actedAs }, { status: o.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
