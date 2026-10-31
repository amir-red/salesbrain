import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { visibleIcp } from '@/lib/icp-server';

/** GET — what this list's ✓ / ↓ marks say about its four trust weights (kernel `crm_trust_tuning`, readable by all). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const icp = await visibleIcp(params.id, session);
  if (!icp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const out = await kernelCall('crm_trust_tuning', { icp_id: icp.id }, session.userId);
    return NextResponse.json(out, { status: out.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

/** POST {weights?} — apply the proposed (or given) weights and re-score the list; the kernel lets owner or admin. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const icp = await visibleIcp(params.id, session);
  if (!icp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let body: { weights?: Record<string, number> } = {};
  try { body = await req.json(); } catch { body = {}; }
  try {
    const out = await kernelCall('crm_trust_apply_tuning', { icp_id: icp.id, weights: body.weights || undefined }, session.userId);
    return NextResponse.json(out, { status: out.error ? (out.refused ? 403 : 400) : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
