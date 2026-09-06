import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * POST /api/graph/sync — queue a graph rebuild for the signed-in user.
 *
 * Queued, not run inline: a first sync promotes thousands of contacts and pages
 * LinkedIn 6 seconds apart, which is minutes of work. Queuing is idempotent —
 * one pending run per owner (migration 038).
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const out = await kernelCall('crm_agent_request_run', { agent: 'graph_sync' }, session.userId);
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not queue a graph sync' },
      { status: 502 },
    );
  }
}
