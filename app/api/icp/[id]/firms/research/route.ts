import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { visibleIcp } from '@/lib/icp-server';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * POST /api/icp/[id]/firms/research { limit?, refresh?, firm_ids? }
 * QUEUES the next unresearched firms of this list (or the given ones) for the research sweep, which runs every
 * 15 minutes. Nothing is researched here — research takes ~20-60 s a firm.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await visibleIcp(params.id, session))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let body: { limit?: number; refresh?: boolean; firm_ids?: string[] } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const limit = Math.max(1, Math.min(200, Math.floor(Number(body.limit) || 25)));
  try {
    const out = await kernelCall('crm_firm_research', {
      icp_id: params.id, limit, refresh: Boolean(body.refresh),
      ...(Array.isArray(body.firm_ids) && body.firm_ids.length ? { firm_ids: body.firm_ids, queue: true } : {}),
    }, session.userId);
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
