import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { guardEditable, visibleIcp } from '@/lib/icp-server';

/**
 * The Leads Finder's cap for one list (migration 105): how many people it may add before it stops searching.
 * GET = the list's search status (ready / missing, cap, finished searches, why it stopped) — anyone who can see the list.
 * POST { max_leads: number } — owner or admin; 0 = back to the default (agents.leads_finder.max_leads_per_list).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const icp = await visibleIcp(params.id, session);
  if (!icp) return NextResponse.json({ error: 'List not found' }, { status: 404 });
  try {
    const out = await kernelCall('crm_leads_finder_list_status', { icp_id: params.id }, session.userId) as Record<string, unknown>;
    return NextResponse.json(out, { status: out.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not read the list status' }, { status: 502 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const guard = await guardEditable(params.id, session);
  if (guard.denied) return guard.denied;
  let body: { max_leads?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const n = Number(body.max_leads);
  if (!Number.isInteger(n) || n < 0 || n > 100000) {
    return NextResponse.json({ error: 'max_leads must be a whole number from 0 (default) to 100000' }, { status: 400 });
  }
  try {
    const out = await kernelCall('crm_icp_set_cap', { icp_id: params.id, max_leads: n }, session.userId) as Record<string, unknown>;
    return NextResponse.json(out, { status: out.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not change the cap' }, { status: 502 });
  }
}
