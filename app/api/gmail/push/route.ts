import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { verifyGoogleIdToken } from '@/lib/google-oidc';

/**
 * POST /api/gmail/push — Gmail push notifications (Cloud Pub/Sub push subscription on GMAIL_PUSH_TOPIC).
 *
 * Google calls this within seconds of a change in a watched inbox (lib/gmail-send.ts watchMailbox). The call is a
 * Google-signed OIDC token for our URL from the service account on our subscription (GMAIL_PUSH_SA) — anything else
 * is refused. The body only says WHICH mailbox changed ({emailAddress, historyId}); we answer at once (Pub/Sub retries
 * a slow answer) and run that mailbox's reply check in the background: the same code as the twice-hourly job
 * (ring email_replies.check → record_email_inbound: reply / bounce / "no thanks"), which is idempotent on the message
 * id, so a duplicate notification changes nothing. A burst of notifications for one mailbox becomes one run (+ one
 * more if something arrived while it ran).
 */
const AUDIENCE = process.env.GMAIL_PUSH_AUDIENCE || `${(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')}/api/gmail/push`;
const running = new Map<string, { again: boolean }>();

function check(userId: string) {
  const st = running.get(userId);
  if (st) { st.again = true; return; }
  running.set(userId, { again: false });
  void kernelCall('email_replies_check', { sender_user_id: userId }, userId)
    .catch((err) => console.error('[gmail push] reply check failed:', err instanceof Error ? err.message : err))
    .finally(() => {
      const again = running.get(userId)?.again;
      running.delete(userId);
      if (again) setTimeout(() => check(userId), 15_000);
    });
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  try {
    await verifyGoogleIdToken(auth.startsWith('Bearer ') ? auth.slice(7) : '', { audience: AUDIENCE, email: process.env.GMAIL_PUSH_SA || '' });
  } catch (err) {
    console.warn('[gmail push] refused:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  let note: { emailAddress?: string; historyId?: string | number } = {};
  try {
    const body = await req.json() as { message?: { data?: string } };
    note = JSON.parse(Buffer.from(body.message?.data || '', 'base64').toString('utf8') || '{}');
  } catch { return new NextResponse(null, { status: 204 }); }       // malformed: acknowledge so it is not retried
  if (note.emailAddress) {
    const { rows } = await pool.query<{ user_id: string }>(
      'SELECT user_id FROM email_senders WHERE lower(address) = lower($1) AND revoked_at IS NULL', [note.emailAddress]);
    for (const r of rows) check(r.user_id);
  }
  return new NextResponse(null, { status: 204 });
}
