import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

/**
 * GET /api/campaigns/options — what a campaign can include and pitch: the caller's ICP lists (an admin sees every
 * one, the same rule as /icp), the /sales-leads sources with how many open leads each holds (org-wide, like the
 * page), the products and the teammates. ONE checked-out client, sequential (pooler: no fan-out).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = session.role === 'admin';
  const client = await pool.connect();
  try {
    const icps = await client.query(
      `SELECT i.id, i.name, u.name AS owner_name,
              (SELECT count(*)::int FROM prospects p WHERE p.icp_profile_id = i.id) AS leads
         FROM icp_profiles i LEFT JOIN users u ON u.id = i.owner_user_id
        WHERE i.is_active ${admin ? '' : 'AND i.owner_user_id = $1'}
        ORDER BY i.updated_at DESC NULLS LAST LIMIT 200`, admin ? [] : [session.userId]);
    const sources = await client.query(
      `SELECT source, count(*)::int AS leads FROM sales_leads
        WHERE source IS NOT NULL AND status NOT IN ('converted', 'archived')
        GROUP BY source ORDER BY count(*) DESC LIMIT 100`);
    const products = await client.query(
      `SELECT id, name FROM products WHERE status IS DISTINCT FROM 'archived' ORDER BY name`);
    return NextResponse.json({ icps: icps.rows, sources: sources.rows, products: products.rows, viewer_is_admin: admin });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  } finally { client.release(); }
}
