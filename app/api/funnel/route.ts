import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { FUNNEL_LANES } from '@/lib/funnel';

/**
 * GET /api/funnel?icp_id=&owner=&lane=&deal_type=  — the funnel strip (lib/funnel.ts FunnelSummary).
 *
 * The kernel (commands/funnel.py) counts every person once at the furthest stage they reached. Aggregates only, so
 * every signed-in teammate may read any slice (same rule as the KPIs: the team sees each other's pipeline).
 * `owner` = a user id, name or email; 'me' = the viewer.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const args: Record<string, string> = {};
  const icp = q.get('icp_id');
  if (icp) {
    if (!/^[0-9a-f-]{36}$/i.test(icp)) return NextResponse.json({ error: 'icp_id must be a list id' }, { status: 400 });
    args.icp_id = icp;
  }
  const owner = q.get('owner');
  if (owner) args.owner = owner;
  const lane = q.get('lane');
  if (lane) {
    if (!(lane in FUNNEL_LANES)) return NextResponse.json({ error: 'unknown lane' }, { status: 400 });
    args.lane = lane;
  }
  const dt = q.get('deal_type');
  if (dt) args.deal_type = dt;
  try {
    const out = await kernelCall('crm_funnel', args, session.userId) as Record<string, unknown>;
    if (out.error) return NextResponse.json(out, { status: 400 });
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not load the funnel' }, { status: 502 });
  }
}
