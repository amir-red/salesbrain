import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { TEAM_USERS_SQL } from '@/lib/sales-leads-sql';

/**
 * GET /api/campaigns/options — what a campaign can include and pitch: the caller's ICP lists (an admin sees every
 * one, the same rule as /icp) with how many people have an email / a LinkedIn profile, the /sales-leads sources with how many open leads each holds (org-wide, like the
 * page), the products, the list owners and every teammate who can be chosen to send or approve. ONE checked-out client, sequential (pooler: no fan-out).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = session.role === 'admin';
  const client = await pool.connect();
  try {
    const icps = await client.query(
      `SELECT i.id, i.name, i.owner_user_id, u.name AS owner_name, c.leads, c.with_email, c.with_linkedin
         FROM icp_profiles i LEFT JOIN users u ON u.id = i.owner_user_id
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS leads,
                  count(*) FILTER (WHERE COALESCE(ct.email, '') <> '')::int AS with_email,
                  count(*) FILTER (WHERE COALESCE(p.linkedin_public_id, '') <> '')::int AS with_linkedin
             FROM prospects p LEFT JOIN contacts ct ON ct.id = p.contact_id WHERE p.icp_profile_id = i.id) c ON true
        WHERE i.is_active ${admin ? '' : 'AND i.owner_user_id = $1'}
        ORDER BY i.updated_at DESC NULLS LAST LIMIT 200`, admin ? [] : [session.userId]);
    const sources = await client.query(
      `SELECT source, count(*)::int AS leads,
              count(*) FILTER (WHERE COALESCE(email, '') <> '')::int AS with_email,
              count(*) FILTER (WHERE COALESCE(linkedin_url, '') <> '')::int AS with_linkedin
         FROM sales_leads
        WHERE source IS NOT NULL AND status NOT IN ('converted', 'archived')
        GROUP BY source ORDER BY count(*) DESC LIMIT 100`);
    const products = await client.query(
      `SELECT id, name FROM products WHERE status IS DISTINCT FROM 'archived' ORDER BY name`);
    // Who would send for each list (its owner) and whether they can: a campaign sends from the owner's own accounts.
    const ownerIds = Array.from(new Set(icps.rows.map((r) => r.owner_user_id).filter(Boolean)));
    const owners = ownerIds.length ? (await client.query(
      `SELECT u.id, u.name,
              EXISTS (SELECT 1 FROM email_senders s WHERE s.user_id = u.id AND s.revoked_at IS NULL) AS has_gmail,
              EXISTS (SELECT 1 FROM linkedin_accounts a WHERE a.owner_user_id = u.id AND a.revoked_at IS NULL) AS has_linkedin
         FROM users u WHERE u.id = ANY($1::uuid[])`, [ownerIds])).rows : [];
    // Everyone who can be chosen to send or to approve (settings.send_from / approve_by), with their accounts.
    const teammates = (await client.query(
      `SELECT t.id, t.name,
              EXISTS (SELECT 1 FROM email_senders s WHERE s.user_id = t.id AND s.revoked_at IS NULL) AS has_gmail,
              EXISTS (SELECT 1 FROM linkedin_accounts a WHERE a.owner_user_id = t.id AND a.revoked_at IS NULL) AS has_linkedin
         FROM (${TEAM_USERS_SQL}) t`)).rows;
    return NextResponse.json({ icps: icps.rows, sources: sources.rows, products: products.rows, owners, teammates, viewer_is_admin: admin });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  } finally { client.release(); }
}
