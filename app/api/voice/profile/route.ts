import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * The sender's measured style (core 098). GET → the viewer's live profiles per channel × language with the block
 * the drafter reads and the corpus counts (?owner= for an admin). POST {action:'refresh'} re-gathers the viewer's
 * own messages from the mirrors; {action:'rebuild'} measures a new profile version and makes it live.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const owner = req.nextUrl.searchParams.get('owner');
  try {
    const out = await kernelCall('sender_profile', { ...(owner && session.role === 'admin' ? { owner_user_id: owner } : {}) }, session.userId);
    return NextResponse.json(out, { status: out.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { action?: string; owner?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const ownerArg = body.owner && session.role === 'admin' ? { owner_user_id: body.owner } : {};
  try {
    if (body.action === 'refresh') {
      const out = await kernelCall('sender_corpus_refresh', ownerArg, session.userId);
      return NextResponse.json(out, { status: out.error ? 400 : 200 });
    }
    if (body.action === 'rebuild') {
      const out = await kernelCall('sender_profile_rebuild', { ...ownerArg, activate: true }, session.userId);
      return NextResponse.json(out, { status: out.error ? 400 : 200 });
    }
    return NextResponse.json({ error: "action must be 'refresh' or 'rebuild'" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
