import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { getThread, setThreadState } from '@/lib/inbox-server';
import { cleanStamp, draftInVoice } from '@/lib/voice-context';
import type { InboxChannel } from '@/lib/inbox';

/**
 * GET  /api/inbox/{email|linkedin|chat}/{id} — one conversation (messages + who it is); opening it marks it seen for its
 *      owner.
 * POST {action:'draft'} — an AI proposal for the next message in this conversation, in the OWNER's own voice (the one
 *      drafter, core 098): a reply when they wrote last, a follow-up when we did. Returns message, reasoning, voice.
 * POST {action:'reply', text, voice?} — sent at once from the owner's own account through the send gate (pressing
 *      Send is the decision; quiet hours / a cap keep it approved for the next window). Only the owner. `voice` = the
 *      stamp from 'draft', so the edit / untouched send / stars afterwards teach the owner's voice.
 *      {action:'done'|'reopen'} — the owner or an admin. {action:'refresh'} — re-read it now (owner).
 */
type Ctx = { params: { channel: string; id: string } };
const UUID = /^[0-9a-f-]{36}$/i;

const CHANNELS: readonly InboxChannel[] = ['email', 'linkedin', 'chat'];

function parse(params: Ctx['params']): { channel: InboxChannel; id: string } | null {
  if (!(CHANNELS as readonly string[]).includes(params.channel) || !UUID.test(params.id)) return null;
  return { channel: params.channel as InboxChannel, id: params.id };
}

/** The next pending step of the thread's active plan, as the drafter's angle (null = no plan / before core 103). */
async function planAngle(channel: string, threadId: string): Promise<{ angle: string; purpose: string } | null> {
  type Row = { steps: { status: string; purpose: string }[]; reason_kind: string; reason: string | null };
  const { rows } = await pool.query<Row>(
    `SELECT cp.steps, cp.reason_kind, cp.reason FROM conversation_plans cp
      WHERE cp.channel = $1 AND cp.thread_id = $2::uuid AND cp.status = 'active' AND cp.decision = 'follow_up'`,
    [channel, threadId]).catch(() => ({ rows: [] as Row[] }));
  const r = rows[0];
  if (!r) return null;
  const step = (r.steps || []).find((s) => s.status === 'pending' || s.status === 'notified' || s.status === 'filed');
  if (!step) return null;
  const why = `${r.reason_kind.replace(/_/g, ' ')}${r.reason ? ` — ${r.reason}` : ''}`;
  return { angle: `${step.purpose}. Why now: ${why}. Keep it to a few lines.`, purpose: step.purpose };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const p = parse(params);
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const thread = await getThread(p.channel, p.id, { userId: session.userId, admin: session.role === 'admin' });
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ thread });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const p = parse(params);
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let body: { action?: string; text?: string; voice?: unknown } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const viewer = { userId: session.userId, admin: session.role === 'admin' };

  if (body.action === 'draft') {
    const thread = await getThread(p.channel, p.id, viewer);
    if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (thread.owner_user_id !== session.userId) return NextResponse.json({ error: 'Only the owner of this account can draft a reply here.' }, { status: 403 });
    // Every conversation of your own can be drafted (2026-11-06): a chat that cannot be sent from here (iMessage, the
    // Zeami link) is copied and sent in the app; a person not in the CRM is drafted from the conversation alone.
    const last = thread.messages[thread.messages.length - 1];
    const theirs = last ? !last.from_me : thread.last_from_them;
    // A conversation plan (core 103) names the purpose of the next step: that is the angle, not the generic one.
    const planned = await planAngle(p.channel, p.id);
    const out = await draftInVoice({
      situation: theirs ? 'reply' : 'followup', channel: p.channel === 'chat' ? 'whatsapp' : p.channel, userId: session.userId, feature: 'inbox_draft',
      prospectId: thread.prospect_id, personId: thread.person_id,
      linkedinThreadId: p.channel === 'linkedin' ? p.id : null,
      emailThreadId: p.channel === 'email' ? p.id : null,
      chatThreadId: p.channel === 'chat' ? p.id : null,
      angle: planned ? planned.angle : theirs ? 'Answer what they said first, then one clear next step.'
        : 'They have not answered our last message: one new useful thing, no apology for following up, one easy question.',
    });
    if ('error' in out) return NextResponse.json({ error: out.error }, { status: 502 });
    return NextResponse.json({ ...out, situation: planned ? 'followup' : theirs ? 'reply' : 'followup', planned: planned?.purpose ?? null });
  }

  if (body.action === 'done' || body.action === 'reopen') {
    const ok = await setThreadState(p.channel, p.id, body.action, viewer);
    return NextResponse.json(ok ? { ok: true } : { error: 'Not found' }, { status: ok ? 200 : 404 });
  }
  if (body.action === 'reply' || body.action === 'refresh') {
    const text = typeof body.text === 'string' ? body.text : '';
    if (body.action === 'reply' && !text.trim()) return NextResponse.json({ error: 'Write a reply first.' }, { status: 400 });
    try {
      const voice = body.action === 'reply' ? cleanStamp(body.voice) : undefined;
      const out = await kernelCall(body.action === 'reply' ? 'inbox_reply' : 'inbox_refresh',
        { channel: p.channel, thread_id: p.id, ...(body.action === 'reply' ? { text, ...(voice ? { voice } : {}) } : {}) }, session.userId);
      const thread = await getThread(p.channel, p.id, viewer);
      return NextResponse.json({ ...out, thread }, { status: out.error ? 400 : 200 });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
