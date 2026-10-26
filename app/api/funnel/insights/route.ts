import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { FUNNEL_PERIODS } from '@/lib/funnel';

/**
 * GET /api/funnel/insights?icp_id=&owner=&period=  — what converts (crm_funnel_insights): everyone we contacted, as they
 * were at first contact, against how far they got. Aggregates only; any signed-in teammate may read any slice.
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
  const period = q.get('period');
  if (period) {
    if (!(period in FUNNEL_PERIODS)) return NextResponse.json({ error: 'unknown period' }, { status: 400 });
    args.period = period;
  }
  try {
    const out = await kernelCall('crm_funnel_insights', args, session.userId) as Record<string, unknown>;
    if (out.error) return NextResponse.json(out, { status: 400 });
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not load insights' }, { status: 502 });
  }
}
