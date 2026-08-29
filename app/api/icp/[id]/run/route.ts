import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * Hand this ICP to the Leads Finder.
 *   { mode: 'now' }   → crm_leads_finder_run: one step synchronously (spends budget now)
 *   { mode: 'queue' } → crm_agent_request_run: picked up on the agent's next tick
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const own = await pool.query(`SELECT id FROM icp_profiles WHERE id = $1 AND owner_user_id = $2 AND is_active`, [params.id, session.userId]);
  if (!own.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { mode?: 'now' | 'queue'; limit?: number } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const mode = body.mode === 'queue' ? 'queue' : 'now';
  try {
    const out = mode === 'queue'
      ? await kernelCall('crm_agent_request_run', { agent: 'leads_finder', icp_id: params.id }, session.userId)
      : await kernelCall('crm_leads_finder_run', { icp_id: params.id, ...(body.limit ? { limit: body.limit } : {}) }, session.userId);
    return NextResponse.json({ mode, ...out });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
