import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listAccepted } from '@/lib/inbox-accepted';

/** GET /api/inbox/accepted?scope=mine|team&q= — LinkedIn connection requests accepted in the last 30 days. */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  try {
    const out = await listAccepted({ userId: session.userId, admin: session.role === 'admin' }, sp.get('scope') === 'team', sp.get('q') || '');
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
