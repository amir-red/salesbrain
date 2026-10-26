import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { guardEditable, visibleIcp } from '@/lib/icp-server';

/**
 * GET  /api/icp/:id/tuning — what answered on this list per fit criterion, and the proposed weights (crm_icp_tuning).
 * POST /api/icp/:id/tuning { weights? } — save the proposed (or given) weights and re-score the list (owner or admin).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await visibleIcp(params.id, session))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const out = await kernelCall('crm_icp_tuning', { icp_id: params.id }, session.userId) as Record<string, unknown>;
    if (out.error) return NextResponse.json(out, { status: 400 });
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not load' }, { status: 502 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const guard = await guardEditable(params.id, session);
  if (guard.denied) return guard.denied;
  let body: { weights?: Record<string, number> } = {};
  try { body = await req.json(); } catch { body = {}; }
  const args: Record<string, unknown> = { icp_id: params.id };
  if (body.weights && typeof body.weights === 'object') args.weights = body.weights;
  try {
    const out = await kernelCall('crm_icp_apply_tuning', args, session.userId) as Record<string, unknown>;
    if (out.error) return NextResponse.json(out, { status: out.refused ? 403 : 400 });
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not apply' }, { status: 502 });
  }
}
