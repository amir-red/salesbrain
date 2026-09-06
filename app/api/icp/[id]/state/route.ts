import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

const STATES = new Set(['running', 'paused', 'stopped']);

/**
 * POST /api/icp/[id]/state { state, reason? } — the per-ICP on/off switch.
 *
 * Goes through the kernel rather than direct SQL so the admin-hold rule and the
 * audit row are enforced in one place; /icp is not a hot path.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const state = typeof body.state === 'string' ? body.state : '';
  if (!STATES.has(state)) {
    return NextResponse.json({ error: 'state must be running | paused | stopped' }, { status: 400 });
  }
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined;

  try {
    const out = await kernelCall(
      'crm_icp_set_state',
      { icp_id: params.id, state, ...(reason ? { reason } : {}) },
      session.userId,
    );
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not change the ICP state' },
      { status: 502 },
    );
  }
}
