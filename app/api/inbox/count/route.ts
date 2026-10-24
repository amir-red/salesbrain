import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { needsReplyCount } from '@/lib/inbox-server';

/** GET /api/inbox/count — how many of my conversations wait for my answer (the sidebar badge). */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({ needs_reply: await needsReplyCount(session.userId) });
  } catch {
    return NextResponse.json({ needs_reply: 0 });
  }
}
