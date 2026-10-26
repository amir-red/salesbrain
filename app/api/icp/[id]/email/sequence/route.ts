import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { guardEditable, visibleIcp } from '@/lib/icp-server';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/** GET / POST { sequence } /api/icp/[id]/email/sequence — the list's emails (subject + steps), placeholders checked. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await visibleIcp(params.id, session))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try { return NextResponse.json(await kernelCall('crm_email_sequence_get', { icp_id: params.id }, session.userId)); }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 }); }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const guard = await guardEditable(params.id, session);
  if (guard.denied) return guard.denied;
  let body: { sequence?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  try { return NextResponse.json(await kernelCall('crm_email_sequence_set', { icp_id: params.id, sequence: body.sequence || {} }, session.userId)); }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 }); }
}
