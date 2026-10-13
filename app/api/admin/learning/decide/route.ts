import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * POST /api/admin/learning/decide {profile, subsystem, id, decision}
 * Approve (apply through Hermes' own applier — same code as `/skills approve`
 * and `/memory approve`) or reject (discard) one staged write. Admin only.
 */
export const dynamic = 'force-dynamic';

const SUBSYSTEMS = new Set(['skills', 'memory']);
const DECISIONS = new Set(['approve', 'reject']);

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const profile = typeof body.profile === 'string' ? body.profile : '';
  const subsystem = typeof body.subsystem === 'string' ? body.subsystem : '';
  const id = typeof body.id === 'string' ? body.id : '';
  const decision = typeof body.decision === 'string' ? body.decision : '';
  if (!profile || !SUBSYSTEMS.has(subsystem) || !/^[0-9a-f]{4,32}$/i.test(id) || !DECISIONS.has(decision)) {
    return NextResponse.json({ error: 'profile, subsystem (skills|memory), id and decision (approve|reject) required' }, { status: 400 });
  }
  try {
    const out = await kernelCall('learning_decide', { profile, subsystem, pending_id: id, decision }, session.userId);
    return NextResponse.json(out, { status: out && (out as { ok?: boolean }).ok === false ? 409 : 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Decision failed: ${msg}` }, { status: 502 });
  }
}
