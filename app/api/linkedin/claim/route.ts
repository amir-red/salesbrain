/**
 * POST /api/linkedin/claim — bind a just-connected Unipile account to me.
 *
 * Called by the LinkedIn tab of /profile after Unipile redirects the user back. Using the
 * session this way avoids exposing a public callback endpoint for Unipile's
 * notify_url: the binding is authenticated as the browser user who just
 * completed the flow, not by a shared secret on an internet-facing route.
 *
 * Safety: only accounts connected in the last 15 minutes and not already bound
 * to anyone are claimable, and if more than one qualifies we refuse rather than
 * guess — binding the wrong LinkedIn account to a user would hand them someone
 * else's inbox. (Two people connecting inside the same window is the only way
 * to hit that; with a small team it is rare, and refusing is the safe failure.)
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { claimLinkedInForUser } from '@/lib/linkedin-claim';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { status, body } = await claimLinkedInForUser(session.userId);
  return NextResponse.json(body, { status });
}
