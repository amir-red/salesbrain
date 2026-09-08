import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * Step 5 of the lead's journey — how do I reach this person.
 * {mode:'find'} is read-only (crm_path_find); {mode:'expand'} spends LinkedIn
 * budget (crm_route_expand: profile, Connections-of search, teammate probe).
 * Both go through the kernel as the acting user, so every gate applies.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { mode?: 'find' | 'expand'; max_hops?: number; k?: number } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const mode = body.mode === 'expand' ? 'expand' : 'find';
  try {
    const out = mode === 'expand'
      ? await kernelCall('crm_route_expand', { prospect_id: params.id }, session.userId)
      : await kernelCall('crm_path_find', { prospect_id: params.id, ...(body.max_hops ? { max_hops: body.max_hops } : {}), ...(body.k ? { k: body.k } : {}) }, session.userId);
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
