/**
 * Compose in the Inbox (2026-11-09): "Write message" on a person page.
 *
 *   GET  ?prospect=<id>                                  what the viewer can do from their own accounts (lib/inbox-compose-server)
 *   POST {action:'draft', prospect_id, channel}          an AI proposal for the first message, in the VIEWER's voice; saves nothing
 *   POST {action:'send', prospect_id, channel, text, subject?, voice?}
 *                                                        sends it now from the viewer's own LinkedIn / default Gmail (kernel
 *                                                        `inbox_compose`: files the approval, approves it as the viewer, same gate)
 * The viewer sends only from their own accounts — never on behalf of the lead's owner (that is the lead card's lane).
 */
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { cleanStamp, draftInVoice } from '@/lib/voice-context';
import { composeFacts } from '@/lib/inbox-compose-server';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('prospect') || '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'prospect is required' }, { status: 400 });
  const client = await pool.connect();
  try {
    const f = await composeFacts(client, id, session.userId);
    if (!f) return NextResponse.json({ error: 'Person not found' }, { status: 404 });
    return NextResponse.json(f);
  } finally { client.release(); }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { action?: string; prospect_id?: string; channel?: string; text?: string; subject?: string; voice?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const id = body.prospect_id || '';
  const channel = body.channel === 'email' ? 'email' : body.channel === 'linkedin' ? 'linkedin' : null;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !channel) return NextResponse.json({ error: 'prospect_id and channel are required' }, { status: 400 });
  if (body.action !== 'draft' && body.action !== 'send') return NextResponse.json({ error: "action must be 'draft' | 'send'" }, { status: 400 });

  const client = await pool.connect();
  let f;
  try { f = await composeFacts(client, id, session.userId); } finally { client.release(); }
  if (!f) return NextResponse.json({ error: 'Person not found' }, { status: 404 });
  const lane = channel === 'linkedin' ? f.linkedin : f.email;
  const can = channel === 'linkedin' ? f.linkedin.mode === 'first_message' : f.email.mode === 'ok';
  if (!can) return NextResponse.json({ error: lane.why || 'Nothing can be sent on this channel yet.', open: lane.thread_key ?? null }, { status: 409 });

  try {
    if (body.action === 'draft') {
      const angle = channel === 'linkedin'
        ? 'Thank them briefly for connecting, give one specific reason we are reaching out, ask one easy question.'
        : 'A first email: one specific reason we write to them, one useful thought for their business, one easy question. No pitch.';
      // the viewer is the sender: their own voice (the kernel takes a prospect's OWNER as sender, so a teammate
      // writing from their own mailbox drafts by person instead)
      const out = await draftInVoice({ situation: 'first', channel, feature: 'inbox_compose', userId: session.userId,
        ...(f.owner.is_viewer || !f.person_id ? { prospectId: id } : { personId: f.person_id }),
        angle, subject: channel === 'email' });
      if ('error' in out) return NextResponse.json({ error: out.error }, { status: 502 });
      return NextResponse.json(out);
    }
    const text = (body.text || '').trim();
    if (!text) return NextResponse.json({ error: 'Write the message first.' }, { status: 400 });
    const voice = cleanStamp(body.voice);
    const out = await kernelCall('inbox_compose', {
      prospect_id: id, channel, text, ...(channel === 'email' ? { subject: (body.subject || '').trim().slice(0, 200) } : {}),
      ...(voice ? { voice } : {}),
    }, session.userId) as Record<string, unknown>;
    return NextResponse.json(out, { status: out.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
