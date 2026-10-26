import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * GET  /api/warm?band=hot|warm|cool&owner=<id|name|me>&include_worked=1&limit=  — warm people (crm_warm_people):
 *      people we already talk to, warmest first; by default those somebody is working are left out. Team-wide read,
 *      like the shared /network map.
 * POST /api/warm { person_id, responsible?, front?, priority?, notes? }  — make one a lead card in the Own network lane
 *      (crm_warm_add_lead). Sends nothing.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const args: Record<string, unknown> = {};
  const band = q.get('band');
  if (band) {
    if (!['hot', 'warm', 'cool'].includes(band)) return NextResponse.json({ error: 'band must be hot, warm or cool' }, { status: 400 });
    args.band = band;
  }
  const owner = q.get('owner');
  if (owner) args.owner = owner;
  if (q.get('include_worked') === '1') args.include_worked = true;
  const limit = Number(q.get('limit'));
  if (limit) args.limit = Math.min(500, Math.max(1, limit));
  try {
    const out = await kernelCall('crm_warm_people', args, session.userId) as Record<string, unknown>;
    if (out.error) return NextResponse.json(out, { status: 400 });
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not load warm people' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (typeof body.person_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.person_id)) {
    return NextResponse.json({ error: 'person_id is required' }, { status: 400 });
  }
  const args: Record<string, unknown> = { person_id: body.person_id };
  for (const k of ['responsible', 'front', 'notes'] as const) if (typeof body[k] === 'string' && body[k]) args[k] = body[k];
  if (typeof body.priority === 'number') args.priority = body.priority;
  try {
    const out = await kernelCall('crm_warm_add_lead', args, session.userId) as Record<string, unknown>;
    if (out.error) return NextResponse.json(out, { status: 400 });
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not add the lead' }, { status: 502 });
  }
}
