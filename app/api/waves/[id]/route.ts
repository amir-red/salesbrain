import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * GET  /api/waves/[id]                 a wave and every draft in it (sender, list owner, admin)
 * POST /api/waves/[id] { decision }    approve | skip — only the SENDER (their mailbox); the outbox sends approved
 *                                      drafts a few every 10 minutes within their daily cap
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json(await kernelCall('crm_email_wave_get', { wave_id: params.id }, session.userId)); }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 }); }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { decision?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (body.decision !== 'approve' && body.decision !== 'skip') return NextResponse.json({ error: 'decision must be approve or skip' }, { status: 400 });
  try { return NextResponse.json(await kernelCall('crm_email_wave_decide', { wave_id: params.id, decision: body.decision }, session.userId)); }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 }); }
}
