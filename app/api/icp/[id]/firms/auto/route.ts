import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { visibleIcp } from '@/lib/icp-server';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/** POST /api/icp/[id]/firms/auto { on } — the list's Automatic switch (research + find people by itself; sends nothing). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await visibleIcp(params.id, session))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let body: { on?: boolean } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  try { return NextResponse.json(await kernelCall('crm_firm_auto_set', { icp_id: params.id, on: body.on !== false }, session.userId)); }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 }); }
}
