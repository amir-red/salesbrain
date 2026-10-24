import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listInbox } from '@/lib/inbox-server';
import type { InboxFilter } from '@/lib/inbox';

/**
 * GET /api/inbox?scope=mine|team&channel=all|email|linkedin&filter=all|needs_reply|unread|done&view=outreach|all&q=
 * Outreach conversations across email and LinkedIn, newest first, plus the counts for the tabs. `team` is for
 * admins (everyone else always sees their own accounts).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const pick = <T extends string>(v: string | null, allowed: readonly T[], dflt: T): T =>
    (allowed as readonly string[]).includes(v || '') ? (v as T) : dflt;
  try {
    const out = await listInbox({
      viewerId: session.userId,
      team: session.role === 'admin' && sp.get('scope') === 'team',
      channel: pick(sp.get('channel'), ['all', 'email', 'linkedin'] as const, 'all'),
      filter: pick<InboxFilter>(sp.get('filter'), ['all', 'needs_reply', 'unread', 'done'] as const, 'all'),
      view: pick(sp.get('view'), ['outreach', 'all'] as const, 'outreach'),
      q: (sp.get('q') || '').trim().slice(0, 100),
      limit: 300,
    });
    return NextResponse.json({ ...out, viewer: { id: session.userId, admin: session.role === 'admin' } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
