import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { visibleIcp } from '@/lib/icp-server';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/** GET /api/icp/[id]/firms/progress — what the automatic firm list is doing (crm_firm_progress). Light; polled. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await visibleIcp(params.id, session))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try { return NextResponse.json(await kernelCall('crm_firm_progress', { icp_id: params.id }, session.userId)); }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 }); }
}
