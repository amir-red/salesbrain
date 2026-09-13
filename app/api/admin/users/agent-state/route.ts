import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { AGENTS, HOLD_STATES } from '@/lib/users-panel';

/**
 * POST /api/admin/users/agent-state { owner_user_id, agent, state, reason? }
 * — pause / stop / continue ONE agent for ONE person (migration 044).
 *
 * Admin only here; the kernel re-checks (an admin may hold anyone, and its
 * audit row is the record). Goes through the ring tool rather than SQL so the
 * admin-lock rule lives in one place.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const owner = typeof body.owner_user_id === 'string' ? body.owner_user_id : '';
  const agent = typeof body.agent === 'string' ? body.agent : '';
  const state = typeof body.state === 'string' ? body.state : '';
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined;
  if (!owner) return NextResponse.json({ error: 'owner_user_id is required' }, { status: 400 });
  if (!(AGENTS as readonly string[]).includes(agent)) return NextResponse.json({ error: `agent must be one of ${AGENTS.join(' | ')}` }, { status: 400 });
  if (!(HOLD_STATES as string[]).includes(state)) return NextResponse.json({ error: 'state must be running | paused | stopped' }, { status: 400 });

  try {
    const out = await kernelCall('crm_agent_set_user_state',
      { agent, state, owner_user_id: owner, ...(reason ? { reason } : {}) }, session.userId);
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not change the agent state' }, { status: 502 });
  }
}
