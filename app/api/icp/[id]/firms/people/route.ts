import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { visibleIcp } from '@/lib/icp-server';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * POST /api/icp/[id]/firms/people { limit? } — QUEUE "find the people" for the next firms of this list that have
 * nobody on it yet (not Out), in the list's order. The sweep (every 15 min) researches, picks, adds and enriches them.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await visibleIcp(params.id, session))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let body: { limit?: number } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const limit = Math.max(1, Math.min(100, Math.floor(Number(body.limit) || 10)));
  try {
    return NextResponse.json(await kernelCall('crm_firm_find_people', { icp_id: params.id, limit }, session.userId));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
