import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { guardEditable, visibleIcp } from '@/lib/icp-server';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { publicUrl } from '@/lib/public-url';

/**
 * GET  /api/icp/[id]/email/waves   the list's waves with sent / queued / failed counts
 * POST /api/icp/[id]/email/waves   { limit?, step?, sender?, include_check? } — file the next wave for the SENDER's
 *      approval (their Telegram card + /waves/[id]); sends nothing.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await visibleIcp(params.id, session))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try { return NextResponse.json(await kernelCall('crm_email_waves_list', { icp_id: params.id }, session.userId)); }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 }); }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const guard = await guardEditable(params.id, session);
  if (guard.denied) return guard.denied;
  let body: { limit?: number; step?: number; sender?: string; include_check?: boolean } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const args: Record<string, unknown> = { icp_id: params.id, base_url: publicUrl(req, '/').origin };
  if (body.limit) args.limit = Math.max(1, Math.min(100, Math.floor(Number(body.limit))));
  if (body.step) args.step = Math.max(0, Math.floor(Number(body.step)));
  if (body.sender) args.sender = String(body.sender);
  if (body.include_check) args.include_check = true;
  try { return NextResponse.json(await kernelCall('crm_email_wave_propose', args, session.userId)); }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 }); }
}
