import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { normalizeCriteria } from '@/lib/icp';
import { ownerQuotas } from '@/lib/quota-server';
import type { Coverage, OverviewIcp, OverviewPayload, StageCounts } from '@/lib/icp-panel';

/**
 * GET /api/icp/overview — the control panel's fleet view: every visible ICP
 * with its stage funnel, coverage, queued work, pending approvals and the
 * owner's quota, in a handful of grouped queries (never per row).
 *
 * Visibility follows GET /api/icp: mine, or ?scope=all for admins (silently
 * ignored for everyone else). Direct SQL on purpose — this is polled every
 * 45 s, and a kernel subprocess per poll would cost more than the queries.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = session.role === 'admin';
  const estate = req.nextUrl.searchParams.get('scope') === 'all' && isAdmin;

  // One checked-out client, queries in sequence: the Supabase pooler is in
  // session mode (15 clients, shared with production), so a polled read must
  // not fan out even for a moment.
  const client = await pool.connect();
  try {
  const icps = await client.query(
      `SELECT i.*, u.name AS owner_name, u.email AS owner_email,
              (u.email LIKE '%.service.salesbrain') AS owner_is_external,
              EXISTS(SELECT 1 FROM linkedin_accounts la
                      WHERE la.owner_user_id = i.owner_user_id AND la.revoked_at IS NULL) AS owner_can_source,
              (SELECT row_to_json(r) FROM (
                 SELECT id, status, trigger, source, started_at, finished_at, analyzed, matched, created, researched, error, detail
                 FROM agent_runs WHERE icp_profile_id = i.id AND status <> 'requested'
                 ORDER BY started_at DESC LIMIT 1) r) AS last_run,
              (SELECT row_to_json(s) FROM (
                 SELECT variant_index, consecutive_empty_runs, last_run_at, next_eligible_at, exhausted_at
                 FROM icp_agent_state WHERE icp_profile_id = i.id) s) AS agent_state
         FROM icp_profiles i JOIN users u ON u.id = i.owner_user_id
        WHERE i.is_active AND ${estate ? 'TRUE' : 'i.owner_user_id = $1'}
        ORDER BY ${estate ? '(SELECT count(*) FROM prospects p WHERE p.icp_profile_id = i.id) DESC,' : ''} i.updated_at DESC`,
      estate ? [] : [session.userId],
    );
  const rules = await client.query(`SELECT value FROM policy_rules WHERE key = 'agents.enricher'`);
  const ids = icps.rows.map((r) => r.id as string);
  const minScore = Number(rules.rows[0]?.value?.min_score ?? 60) || 60;

  const none = { rows: [] as Record<string, never>[] };
  const stages = ids.length === 0 ? none : await client.query(
        `SELECT icp_profile_id, stage, count(*)::int AS n FROM prospects
          WHERE icp_profile_id = ANY($1::uuid[]) GROUP BY 1, 2`, [ids]);
  const coverage = ids.length === 0 ? none : await client.query(
        `SELECT p.icp_profile_id, count(*)::int AS total,
                count(*) FILTER (WHERE p.icp_score IS NOT NULL)::int AS scored,
                count(*) FILTER (WHERE p.fit_label IN ('strong_fit','proceed_with_caution'))::int AS matched,
                count(*) FILTER (WHERE p.icp_score >= $2)::int AS eligible,
                count(*) FILTER (WHERE p.account_id IS NOT NULL)::int AS employer,
                count(*) FILTER (WHERE p.research_summary IS NOT NULL)::int AS research,
                count(*) FILTER (WHERE c.email IS NOT NULL)::int AS email,
                count(*) FILTER (WHERE jsonb_typeof(p.warm_paths) = 'array' AND EXISTS (
                  SELECT 1 FROM jsonb_array_elements(p.warm_paths) w WHERE w->>'type' <> 'route'))::int AS warm,
                count(*) FILTER (WHERE p.warm_paths @> '[{"type":"route"}]'::jsonb)::int AS routed,
                count(*) FILTER (WHERE p.warm_paths @> '[{"type":"route","path_available":true}]'::jsonb)::int AS route_available,
                count(*) FILTER (WHERE p.engaged_at IS NOT NULL)::int AS engaged,
                count(*) FILTER (WHERE p.converted_deal_id IS NOT NULL)::int AS deals
           FROM prospects p LEFT JOIN contacts c ON c.id = p.contact_id
          WHERE p.icp_profile_id = ANY($1::uuid[]) GROUP BY 1`, [ids, minScore]);
  const approvals = ids.length === 0 ? none : await client.query(
        `SELECT p.icp_profile_id,
                count(*) FILTER (WHERE oa.status = 'pending')::int AS pending,
                count(*) FILTER (WHERE oa.status = 'sent')::int AS sent
           FROM outreach_approvals oa
           JOIN prospects p ON p.id = COALESCE(oa.intro_for_prospect_id, oa.prospect_id)
          WHERE p.icp_profile_id = ANY($1::uuid[]) GROUP BY 1`, [ids]);
  const queued = ids.length === 0 ? none : await client.query(
        `SELECT icp_profile_id, agent, count(*)::int AS n FROM agent_runs
          WHERE icp_profile_id = ANY($1::uuid[]) AND status = 'requested' GROUP BY 1, 2`, [ids]);
  const ownerIds = Array.from(new Set(icps.rows.map((r) => r.owner_user_id as string)));
  const quota = await ownerQuotas(ownerIds, client);
  const holds = ownerIds.length === 0 ? none : await client.query(
        `SELECT owner_user_id, agent, state, reason, by_admin FROM user_agent_state
          WHERE state <> 'running' AND owner_user_id = ANY($1::uuid[])`, [ownerIds]);
  const holdsBy: Record<string, Record<string, string>> = {};
  for (const h of holds.rows) {
    (holdsBy[h.owner_user_id] ??= {})[h.agent] =
      `${h.state} by ${h.by_admin ? 'an administrator' : 'the owner'}${h.reason ? `: ${h.reason}` : ''}`;
  }

  const stagesBy: Record<string, StageCounts> = {};
  for (const r of stages.rows) (stagesBy[r.icp_profile_id] ??= {})[r.stage as keyof StageCounts] = r.n;
  const coverageBy = Object.fromEntries(coverage.rows.map((r) => [r.icp_profile_id, r]));
  const approvalsBy = Object.fromEntries(approvals.rows.map((r) => [r.icp_profile_id, r]));
  const queuedBy: Record<string, { leads_finder: number; enricher: number }> = {};
  for (const r of queued.rows) {
    const q = (queuedBy[r.icp_profile_id] ??= { leads_finder: 0, enricher: 0 });
    if (r.agent === 'leads_finder') q.leads_finder = r.n; else if (r.agent === 'enricher') q.enricher = r.n;
  }
  const zeroCoverage: Coverage = { total: 0, scored: 0, matched: 0, eligible: 0, employer: 0, research: 0, email: 0, warm: 0, routed: 0, route_available: 0, engaged: 0, deals: 0 };

  const payload: OverviewPayload = {
    is_admin: isAdmin,
    scope: estate ? 'all' : 'mine',
    viewer_user_id: session.userId,
    icps: icps.rows.map((r): OverviewIcp => {
      const cov = coverageBy[r.id] ?? zeroCoverage;
      return {
        ...r,
        criteria: normalizeCriteria(r.criteria),
        prospects: cov.total,
        matched_prospects: cov.matched,
        queued_runs: (queuedBy[r.id]?.leads_finder ?? 0) + (queuedBy[r.id]?.enricher ?? 0),
        stages: stagesBy[r.id] ?? {},
        coverage: { ...zeroCoverage, ...cov, icp_profile_id: undefined } as Coverage,
        approvals: { pending: approvalsBy[r.id]?.pending ?? 0, sent: approvalsBy[r.id]?.sent ?? 0 },
        queued: queuedBy[r.id] ?? { leads_finder: 0, enricher: 0 },
      };
    }),
    quota_by_owner: quota,
    holds_by_owner: holdsBy,
  };
  return NextResponse.json(payload);
  } finally { client.release(); }
}
