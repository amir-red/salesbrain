import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { guardEditable } from '@/lib/icp-server';

/**
 * The daily LinkedIn connector for one list (migration 094). POST { mode: 'off' | 'card' | 'auto' } — owner or admin.
 * Goes through the kernel (commands/icp_owner.py::set_daily_connect) so the change is audited and the answer names
 * the sender and whether they can send (LinkedIn connected, on Telegram). Nothing is sent by this call.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const guard = await guardEditable(params.id, session);
  if (guard.denied) return guard.denied;
  let body: { mode?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (body.mode !== 'off' && body.mode !== 'card' && body.mode !== 'auto') {
    return NextResponse.json({ error: 'mode must be off | card | auto' }, { status: 400 });
  }
  try {
    const out = await kernelCall('crm_icp_daily_connect', { icp_id: params.id, mode: body.mode }, session.userId) as Record<string, unknown>;
    if (out.error) return NextResponse.json(out, { status: out.refused ? 403 : 400 });
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not change the daily connector' }, { status: 502 });
  }
}
