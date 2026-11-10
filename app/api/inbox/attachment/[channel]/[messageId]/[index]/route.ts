import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { threadAccess } from '@/lib/inbox-server';
import { gmailFile } from '@/lib/gmail-send';
import { unipileFile } from '@/lib/unipile';
import { fileHeaders, readFile, safeName } from '@/lib/message-files';
import type { InboxChannel } from '@/lib/inbox';

/**
 * GET /api/inbox/attachment/{email|linkedin|chat}/{message id}/{n}[?inline=1] — the n-th file of a stored message
 * (core 104), for whoever may open that conversation (its owner, or an admin within the personal-mail rule). The
 * Inbox keeps only references: an email file is fetched from the owner's Gmail, a LinkedIn / WhatsApp file from
 * Unipile, a file we sent from our own copy.
 */
type Ctx = { params: { channel: string; messageId: string; index: string } };
const UUID = /^[0-9a-f-]{36}$/i;
const TABLE: Record<InboxChannel, string> = { email: 'email_messages', linkedin: 'linkedin_messages', chat: 'chat_messages' };

export async function GET(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const channel = params.channel as InboxChannel;
  const n = Number(params.index);
  if (!TABLE[channel] || !UUID.test(params.messageId) || !Number.isInteger(n) || n < 0 || n > 50) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const viewer = { userId: session.userId, admin: session.role === 'admin' };
  const idCol = channel === 'linkedin' ? 'provider_message_id' : channel === 'email' ? 'gmail_message_id' : 'message_key';
  const { rows } = await pool.query(
    `SELECT m.thread_id::text AS thread_id, m.${idCol} AS provider_id, m.attachments FROM ${TABLE[channel]} m WHERE m.id = $1`,
    [params.messageId]);
  const msg = rows[0];
  const att = msg && Array.isArray(msg.attachments) ? msg.attachments[n] : null;
  if (!msg || !att) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const access = await threadAccess(channel, msg.thread_id, viewer);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const inline = req.nextUrl.searchParams.get('inline') === '1';

  let name = safeName(att.name);
  let mime: string | null = att.mime || null;
  let content: Buffer;
  if (att.file_id) {
    // one of ours: the copy we sent (readFile checks uploader / admin; the conversation check above already passed)
    const f = await readFile(String(att.file_id), { userId: access.owner_user_id, admin: true });
    if (!f) return NextResponse.json({ error: 'This file is no longer kept.' }, { status: 410 });
    content = f.content; mime = f.mime;
  } else if (channel === 'email') {
    const t = await pool.query(`SELECT mailbox FROM email_threads WHERE id = $1`, [msg.thread_id]);
    const got = await gmailFile(access.owner_user_id, t.rows[0]?.mailbox ?? null, String(msg.provider_id), String(att.part_id || ''));
    if ('error' in got) return NextResponse.json({ error: got.error }, { status: 502 });
    content = got.content; mime = mime || got.mime; name = safeName(got.name || name);
  } else {
    if (att.unavailable) return NextResponse.json({ error: 'The app no longer has this file.' }, { status: 410 });
    const got = await unipileFile(String(msg.provider_id), String(att.id || ''));
    if ('error' in got) return NextResponse.json({ error: got.error }, { status: 502 });
    content = got.content; mime = mime || got.mime;
  }
  return new NextResponse(new Uint8Array(content), { headers: fileHeaders(name, mime, content.length, inline) });
}
