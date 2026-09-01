/**
 * GET /api/admin/service-activity — admin monitoring for the Outreach Service
 * MCP (/api/service-mcp). The sibling app's employees are each a provisioned
 * SalesBrain owner (external_employees), so their ICPs/leads/drafts are invisible
 * on the owner-scoped /icp and per-user pages. This endpoint reads ACROSS those
 * owners (admin only) so we can watch what each connected app is doing.
 *
 *   GET                       → per-app rollup + per-employee activity table
 *   GET ?user_id=<uuid>       → drill-down: that employee's leads + pending drafts
 */
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const drillUser = req.nextUrl.searchParams.get('user_id');

  // ── Drill-down: one employee's leads + pending drafts (guard to a real
  //    provisioned employee so this can't read arbitrary users). ──
  if (drillUser) {
    const owned = await pool.query(
      `SELECT app_key, employee_id, display_name FROM external_employees WHERE salesbrain_user_id = $1`,
      [drillUser],
    );
    if (!owned.rows.length) return NextResponse.json({ error: 'Not a service employee' }, { status: 404 });

    const [icps, leads, approvals] = await Promise.all([
      pool.query(
        `SELECT i.id, i.name, i.product, i.description, i.search_keywords,
                i.filters, i.criteria, i.is_active, i.created_at,
                (SELECT count(*)::int FROM prospects p WHERE p.icp_profile_id = i.id) AS prospects
         FROM icp_profiles i
         WHERE i.owner_user_id = $1
         ORDER BY i.is_active DESC, i.updated_at DESC`,
        [drillUser],
      ),
      pool.query(
        `SELECT p.id, p.stage, p.icp_score, p.fit_label, p.research_summary,
                p.network_degree, p.created_at, i.name AS icp_name,
                c.full_name, c.title, c.email, c.linkedin_url,
                a.name AS company_name, a.industry
         FROM prospects p
         LEFT JOIN contacts c ON c.id = p.contact_id
         LEFT JOIN accounts a ON a.id = p.account_id
         LEFT JOIN icp_profiles i ON i.id = p.icp_profile_id
         WHERE p.owner_user_id = $1
         ORDER BY p.icp_score DESC NULLS LAST, p.created_at DESC LIMIT 200`,
        [drillUser],
      ),
      pool.query(
        `SELECT oa.id, oa.status, oa.channel, oa.subject, oa.message, oa.rationale,
                oa.created_at, oa.sent_at, oa.decided_at,
                pe.full_name AS person_name, c.title, a.name AS company, p.icp_score
         FROM outreach_approvals oa
         LEFT JOIN people pe ON pe.id = oa.person_id
         LEFT JOIN prospects p ON p.id = oa.prospect_id
         LEFT JOIN contacts c ON c.id = p.contact_id
         LEFT JOIN accounts a ON a.id = p.account_id
         WHERE oa.owner_user_id = $1
         ORDER BY oa.created_at DESC LIMIT 100`,
        [drillUser],
      ),
    ]);
    return NextResponse.json({ employee: owned.rows[0], icps: icps.rows, leads: leads.rows, approvals: approvals.rows });
  }

  // ── Overview: one row per provisioned employee, with counts. ──
  const { rows } = await pool.query(
    `SELECT e.app_key, e.employee_id, e.display_name, e.email,
            e.salesbrain_user_id, e.created_at, e.last_seen_at,
            (SELECT count(*)::int FROM icp_profiles i
               WHERE i.owner_user_id = e.salesbrain_user_id AND i.is_active) AS icps,
            (SELECT count(*)::int FROM prospects p
               WHERE p.owner_user_id = e.salesbrain_user_id) AS leads,
            (SELECT count(*)::int FROM prospects p
               WHERE p.owner_user_id = e.salesbrain_user_id AND p.research_summary IS NOT NULL) AS researched,
            (SELECT count(*)::int FROM outreach_approvals oa
               WHERE oa.owner_user_id = e.salesbrain_user_id AND oa.status = 'pending') AS pending,
            (SELECT count(*)::int FROM outreach_approvals oa
               WHERE oa.owner_user_id = e.salesbrain_user_id AND oa.status = 'sent') AS sent,
            la.last_activity
     FROM external_employees e
     LEFT JOIN LATERAL (
       SELECT max(ts) AS last_activity FROM (
         SELECT max(started_at) AS ts FROM agent_runs WHERE owner_user_id = e.salesbrain_user_id
         UNION ALL SELECT max(created_at) FROM outreach_approvals WHERE owner_user_id = e.salesbrain_user_id
         UNION ALL SELECT max(created_at) FROM prospects WHERE owner_user_id = e.salesbrain_user_id
       ) x
     ) la ON true
     ORDER BY e.app_key, la.last_activity DESC NULLS LAST, e.created_at DESC`,
  );

  // Per-app rollup.
  const apps: Record<string, { app_key: string; employees: number; icps: number; leads: number; pending: number; sent: number; last_activity: string | null }> = {};
  for (const r of rows) {
    const a = (apps[r.app_key] ||= { app_key: r.app_key, employees: 0, icps: 0, leads: 0, pending: 0, sent: 0, last_activity: null });
    a.employees += 1; a.icps += r.icps; a.leads += r.leads; a.pending += r.pending; a.sent += r.sent;
    if (r.last_activity && (!a.last_activity || r.last_activity > a.last_activity)) a.last_activity = r.last_activity;
  }

  return NextResponse.json({ apps: Object.values(apps), employees: rows });
}
