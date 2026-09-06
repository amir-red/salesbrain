import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * "Launch" — source prospects from Sales Navigator for this ICP. Delegates to
 * crm_prospect_search (ring-native: resolves filters, spends LinkedIn quota,
 * lands scored prospects). On-demand only, as the tool itself insists.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const own = await pool.query(
    `SELECT id, name, paused_at FROM icp_profiles WHERE id = $1 AND owner_user_id = $2 AND is_active`,
    [params.id, session.userId],
  );
  if (!own.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (own.rows[0].paused_at) {
    return NextResponse.json({ error: `"${own.rows[0].name}" is paused. Resume it to source again.` }, { status: 409 });
  }

  let body: { limit?: number; sales_navigator?: boolean } = {};
  try { body = await req.json(); } catch { /* defaults */ }

  try {
    const out = await kernelCall('crm_prospect_search', {
      icp_id: params.id,
      limit: Math.min(Math.max(Number(body.limit) || 25, 1), 50),
      sales_navigator: body.sales_navigator !== false,
    }, session.userId);
    return NextResponse.json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
