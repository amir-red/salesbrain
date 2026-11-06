import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { disconnectGoogle } from '@/lib/google-connect';

/** POST — disconnect the person's Google: contacts/Gmail sync and sending stop together. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // { mailbox } disconnects that one Google account (core 102: a person may have several); no body = all of them.
  let body: { mailbox?: string } = {};
  try { body = await req.json(); } catch { /* no body */ }
  await disconnectGoogle(session.userId, typeof body.mailbox === 'string' && body.mailbox ? body.mailbox : null);
  return NextResponse.json({ disconnected: true, mailbox: body.mailbox ?? null });
}
