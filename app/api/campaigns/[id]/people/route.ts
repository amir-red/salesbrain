import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/** GET /api/campaigns/[id]/people?status=&node_id= — who is in the campaign, at which step, and why they wait. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const args: Record<string, unknown> = { campaign_id: params.id, limit: 1000 };
  if (sp.get('status')) args.status = sp.get('status');
  if (sp.get('node_id')) args.node_id = sp.get('node_id');
  try { return NextResponse.json(await kernelCall('crm_campaign_people', args, session.userId)); }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 }); }
}
