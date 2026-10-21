import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/** PATCH /api/waves/drafts/[id] { subject?, message?, remove? } — edit or drop one draft while its wave waits. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { subject?: string; message?: string; remove?: boolean } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const args: Record<string, unknown> = { approval_id: params.id };
  if (body.subject !== undefined) args.subject = body.subject;
  if (body.message !== undefined) args.message = body.message;
  if (body.remove) args.remove = true;
  try { return NextResponse.json(await kernelCall('crm_email_wave_edit', args, session.userId)); }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 }); }
}
