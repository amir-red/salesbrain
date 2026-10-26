import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { guardEditable } from '@/lib/icp-server';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/** POST /api/icp/[id]/firms/brief { brief } — what every firm on the list is judged against; re-judges the list. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const guard = await guardEditable(params.id, session);
  if (guard.denied) return guard.denied;
  let body: { brief?: Record<string, unknown> } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  try {
    return NextResponse.json(await kernelCall('crm_firm_brief_set', { icp_id: params.id, brief: body.brief || {} }, session.userId));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
