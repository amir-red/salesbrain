import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * The trust ladder (core 098). GET → the viewer's slices (situation × channel) with level, streak, evaluation and
 * what promotion still needs; ?evals=1 adds the nightly evaluation runs. POST {situation, channel, opted_in?, level?}
 * → opt a slice in / out or pause it (level 'draft'); an admin may set a level by hand and name ?owner.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const ownerArg = sp.get('owner') && session.role === 'admin' ? { owner_user_id: sp.get('owner') } : {};
  try {
    const out = await kernelCall('sender_trust', ownerArg, session.userId);
    if (out.error) return NextResponse.json(out, { status: 400 });
    if (sp.get('evals') === '1') {
      const ev = await kernelCall('draft_evals', { ...ownerArg, limit: 40 }, session.userId);
      return NextResponse.json({ ...out, evals: ev.evals ?? [] });
    }
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { situation?: string; channel?: string; opted_in?: boolean; level?: string; owner?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.situation || !body.channel) return NextResponse.json({ error: 'situation and channel are required' }, { status: 400 });
  try {
    const out = await kernelCall('sender_trust_set', {
      situation: body.situation, channel: body.channel,
      ...(typeof body.opted_in === 'boolean' ? { opted_in: body.opted_in } : {}),
      ...(body.level ? { level: body.level } : {}),
      ...(body.owner && session.role === 'admin' ? { owner_user_id: body.owner } : {}),
    }, session.userId);
    return NextResponse.json(out, { status: out.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
