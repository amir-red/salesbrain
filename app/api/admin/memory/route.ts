import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * GET  /api/admin/memory — team-note proposals, active team notes, per-user counts.
 * POST /api/admin/memory {id, approve} — decide one proposal (`crm_memory_decide`).
 * Admin only (the kernel re-checks).
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  try {
    return NextResponse.json(await kernelCall('memory_team_overview', {}, session.userId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Team memory failed: ${msg}` }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { id?: string; approve?: boolean };
  if (!body.id || !/^[0-9a-f-]{36}$/i.test(body.id) || typeof body.approve !== 'boolean') {
    return NextResponse.json({ error: 'id and approve (boolean) required' }, { status: 400 });
  }
  try {
    const out = await kernelCall('crm_memory_decide', { memory_id: body.id, approve: body.approve }, session.userId);
    return NextResponse.json(out, { status: (out as { error?: string }).error ? 409 : 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Decision failed: ${msg}` }, { status: 502 });
  }
}
