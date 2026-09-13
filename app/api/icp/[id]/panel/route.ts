import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { normalizeCriteria } from '@/lib/icp';
import type { AgentRun } from '@/lib/icp';
import { visibleIcp } from '@/lib/icp-server';
import { ownerQuotas } from '@/lib/quota-server';
import { blockersFor } from '@/lib/icp-panel';
import type { Coverage, PanelApproval, PanelPayload, StageCounts } from '@/lib/icp-panel';

const RUN_COLS = `r.id, r.agent, r.trigger, r.source, r.status, r.started_at, r.finished_at,
  r.analyzed, r.matched, r.created, r.researched, r.detail, r.error, r.icp_profile_id,
  i.name AS icp_name, u.name AS owner_name`;
const RUN_FROM = `FROM agent_runs r LEFT JOIN icp_profiles i ON i.id = r.icp_profile_id LEFT JOIN users u ON u.id = r.owner_user_id`;
// warm_paths is a jsonb ARRAY of entries; guard the odd row that is not.
const WARM = `CASE WHEN jsonb_typeof(p.warm_paths) = 'array' THEN p.warm_paths ELSE '[]'::jsonb END`;

/**
 * GET /api/icp/[id]/panel — everything the drill-down shows for one ICP, in
 * one round trip: definition, fit, funnel, coverage, Leads Finder state and
 * budget, Enricher attempts, graph and routes, approvals and intros, and the
 * activity feed. Owner or admin.
 *
 * Direct SQL on ONE checked-out client, queries in sequence. The Supabase
 * pooler runs in session mode with 15 clients shared with production; a
 * polled read that fans out 20 queries at once exhausts it (that exact 500
 * happened on the first run of this route). Aggregates are merged so the
 * whole payload is a dozen short queries.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const icp = await visibleIcp(params.id, session);
  if (!icp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const id = icp.id;
  const owner = icp.owner_user_id;

  const client = await pool.connect();
  try {
    const q = client.query.bind(client);
    const rules = await q(`SELECT key, value FROM policy_rules WHERE key IN ('agents.kill_switch','agents.leads_finder','agents.enricher','agents.graph_sync','agents.outreach')`);
    const rule = Object.fromEntries(rules.rows.map((r) => [r.key, (r.value ?? {}) as Record<string, unknown>]));
    const minScore = Number(rule['agents.enricher']?.min_score ?? 60) || 60;
    const quotaBy = await ownerQuotas([owner], client);
    // The owner's per-person Leads Finder hold (migration 044), for the blocker list.
    const holdRow = await q(
      `SELECT state, reason, by_admin FROM user_agent_state
        WHERE owner_user_id = $1 AND agent = 'leads_finder' AND state <> 'running'`, [owner]);
    const h = holdRow.rows[0];
    const userHold: string | null = h
      ? `${h.state} by ${h.by_admin ? 'an administrator' : 'the owner'}${h.reason ? `: ${h.reason}` : ''}`
      : null;

    // Fit, coverage and degrees are all FILTERed counts over the same rows; the
    // stage funnel rides along as a jsonb object.
    const agg = await q(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE p.icp_score IS NOT NULL)::int AS scored,
              count(*) FILTER (WHERE p.fit_label IN ('strong_fit','proceed_with_caution'))::int AS matched,
              count(*) FILTER (WHERE p.icp_score >= $2)::int AS eligible,
              count(*) FILTER (WHERE p.account_id IS NOT NULL)::int AS employer,
              count(*) FILTER (WHERE p.research_summary IS NOT NULL)::int AS research,
              count(*) FILTER (WHERE c.email IS NOT NULL)::int AS email,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(${WARM}) w WHERE w->>'type' <> 'route'))::int AS warm,
              count(*) FILTER (WHERE p.warm_paths @> '[{"type":"route"}]'::jsonb)::int AS routed,
              count(*) FILTER (WHERE p.warm_paths @> '[{"type":"route","path_available":true}]'::jsonb)::int AS route_available,
              count(*) FILTER (WHERE p.engaged_at IS NOT NULL)::int AS engaged,
              count(*) FILTER (WHERE p.converted_deal_id IS NOT NULL)::int AS deals,
              count(*) FILTER (WHERE p.fit_label = 'strong_fit')::int AS strong,
              count(*) FILTER (WHERE p.fit_label = 'proceed_with_caution')::int AS proceed,
              count(*) FILTER (WHERE p.fit_label = 'weak_fit')::int AS weak,
              count(*) FILTER (WHERE p.fit_label = 'do_not_pursue')::int AS do_not_pursue,
              count(*) FILTER (WHERE p.icp_score IS NULL)::int AS unscored,
              count(*) FILTER (WHERE p.network_degree = '1')::int AS d1,
              count(*) FILTER (WHERE p.network_degree = '2')::int AS d2,
              count(*) FILTER (WHERE p.network_degree = '3')::int AS d3,
              count(*) FILTER (WHERE p.network_degree IS NULL OR p.network_degree NOT IN ('1','2','3'))::int AS unknown,
              (SELECT coalesce(jsonb_object_agg(s.stage, s.n), '{}'::jsonb) FROM (
                 SELECT stage, count(*)::int AS n FROM prospects WHERE icp_profile_id = $1 GROUP BY 1) s) AS stages
         FROM prospects p LEFT JOIN contacts c ON c.id = p.contact_id
        WHERE p.icp_profile_id = $1`, [id, minScore]);
    const a = agg.rows[0];

    const finder = await q(
      `SELECT (SELECT row_to_json(s) FROM (
                 SELECT variant_index, page_cursor, consecutive_empty_runs, last_run_at, next_eligible_at, exhausted_at
                   FROM icp_agent_state WHERE icp_profile_id = $1) s) AS state,
              (SELECT coalesce(jsonb_object_agg(agent, n), '{}'::jsonb) FROM (
                 SELECT agent, count(*)::int AS n FROM agent_runs WHERE icp_profile_id = $1 AND status = 'requested' GROUP BY 1) qq) AS queued,
              (SELECT coalesce(jsonb_agg(d ORDER BY d.day), '[]'::jsonb) FROM (
                 SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day,
                        count(*) FILTER (WHERE status IN ('success','partial'))::int AS runs,
                        coalesce(sum(analyzed), 0)::int AS analyzed, coalesce(sum(matched), 0)::int AS matched, coalesce(sum(created), 0)::int AS created
                   FROM agent_runs WHERE icp_profile_id = $1 AND agent = 'leads_finder' AND started_at > now() - interval '7 days'
                  GROUP BY 1) d) AS daily`, [id]);
    const f = finder.rows[0];

    const attempts = await q(
      `SELECT pe.kind, pe.result, count(*)::int AS n, coalesce(sum(pe.credits), 0)::int AS credits
         FROM prospect_enrichment pe JOIN prospects p ON p.id = pe.prospect_id
        WHERE p.icp_profile_id = $1 AND pe.created_at > now() - interval '7 days'
        GROUP BY 1, 2 ORDER BY 1, 2`, [id]);
    const failures = await q(
      `SELECT pe.prospect_id, c.full_name, pe.kind, pe.source, pe.result, pe.created_at, pe.detail
         FROM prospect_enrichment pe JOIN prospects p ON p.id = pe.prospect_id LEFT JOIN contacts c ON c.id = p.contact_id
        WHERE p.icp_profile_id = $1 AND pe.result IN ('error','conflict','suppressed')
        ORDER BY pe.created_at DESC LIMIT 10`, [id]);

    const graph = await q(
      `SELECT (SELECT row_to_json(t) FROM (
                 SELECT count(*)::int AS edges, count(DISTINCT dst_person_id)::int AS people FROM person_edges WHERE owner_user_id = $1) t) AS totals,
              (SELECT row_to_json(s) FROM (
                 SELECT phase, relations_pages_done, relations_seen, mirror_completed_at, last_run_at, last_error
                   FROM graph_sync_state WHERE owner_user_id = $1) s) AS sync`, [owner]);
    const hops = await q(
      `SELECT (r->>'best_path_hops')::int AS hops, count(*)::int AS n
         FROM prospects p, jsonb_array_elements(${WARM}) r
        WHERE p.icp_profile_id = $1 AND r->>'type' = 'route' AND coalesce((r->>'path_available')::boolean, false)
        GROUP BY 1 ORDER BY 1`, [id]);
    const topRouted = await q(
      `SELECT p.id AS prospect_id, c.full_name, acc.name AS company_name, p.icp_score,
              (r->>'best_path_hops')::int AS hops, r->>'computed_at' AS computed_at
         FROM prospects p LEFT JOIN contacts c ON c.id = p.contact_id LEFT JOIN accounts acc ON acc.id = p.account_id,
              jsonb_array_elements(${WARM}) r
        WHERE p.icp_profile_id = $1 AND r->>'type' = 'route' AND coalesce((r->>'path_available')::boolean, false)
        ORDER BY hops ASC, p.icp_score DESC NULLS LAST LIMIT 10`, [id]);

    const approvals = await q(
      `SELECT oa.id, oa.status, oa.kind, oa.channel, oa.subject, oa.message, oa.rationale, oa.created_at,
              oa.decided_at, oa.sent_at, oa.expires_at,
              pe.full_name AS person_name, lc.full_name AS intro_lead_name, u.name AS owner_name,
              lp.id AS lead_prospect_id
         FROM outreach_approvals oa
         JOIN prospects lp ON lp.id = COALESCE(oa.intro_for_prospect_id, oa.prospect_id)
         LEFT JOIN people pe ON pe.id = oa.person_id
         LEFT JOIN contacts lc ON lc.id = lp.contact_id
         LEFT JOIN users u ON u.id = oa.owner_user_id
        WHERE lp.icp_profile_id = $1
        ORDER BY oa.created_at DESC LIMIT 50`, [id]);
    const intros = await q(
      `SELECT ir.id, ir.state, ir.prospect_id, ir.sent_at, ir.next_followup_at, ir.created_at,
              pe.full_name AS connector_name, lc.full_name AS lead_name
         FROM intro_requests ir
         JOIN prospects p ON p.id = ir.prospect_id
         LEFT JOIN people pe ON pe.id = ir.connector_person_id
         LEFT JOIN contacts lc ON lc.id = p.contact_id
        WHERE p.icp_profile_id = $1
        ORDER BY ir.created_at DESC LIMIT 100`, [id]);

    // One feed serves every section: this ICP's own runs, the owner's
    // enricher and graph syncs (owner-scoped, icp NULL), and the outreach
    // routine (fleet-wide). Each section slices what it needs from it.
    const activity = await q(
      `SELECT ${RUN_COLS} ${RUN_FROM}
        WHERE r.status <> 'requested'
          AND (r.icp_profile_id = $1
               OR (r.owner_user_id = $2 AND r.icp_profile_id IS NULL AND r.agent IN ('enricher','graph_sync'))
               OR (r.agent = 'outreach' AND r.icp_profile_id IS NULL))
        ORDER BY r.started_at DESC LIMIT 60`, [id, owner]);
    const runs = activity.rows as AgentRun[];

    const killSwitch = rule['agents.kill_switch']?.enabled !== false;
    const enabled: Record<string, boolean> = {
      leads_finder: Boolean(rule['agents.leads_finder']?.enabled),
      enricher: Boolean(rule['agents.enricher']?.enabled),
      graph_sync: Boolean(rule['agents.graph_sync']?.enabled),
      outreach: Boolean(rule['agents.outreach']?.enabled),
    };
    const quota = quotaBy[owner];
    const finderState = (f.state ?? null) as PanelPayload['finder']['state'];

    // Seven calendar days, oldest first, zero-filled so the sparkline has a stable width.
    const dailyBy = Object.fromEntries((f.daily as { day: string; runs: number; analyzed: number; matched: number; created: number }[]).map((r) => [r.day, r]));
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setUTCDate(d.getUTCDate() - (6 - i));
      const day = d.toISOString().slice(0, 10);
      const row = dailyBy[day];
      return { day, runs: row?.runs ?? 0, analyzed: row?.analyzed ?? 0, matched: row?.matched ?? 0, created: row?.created ?? 0 };
    });
    const queuedBy = (f.queued ?? {}) as Record<string, number>;

    const byStatus: Record<string, number> = {};
    for (const ap of approvals.rows) byStatus[ap.status] = (byStatus[ap.status] ?? 0) + 1;
    const byState: Record<string, number> = {};
    for (const ir of intros.rows) byState[ir.state] = (byState[ir.state] ?? 0) + 1;
    const OPEN = new Set(['drafted', 'pending_approval', 'sent', 'awaiting_reply']);

    const coverage: Coverage = {
      total: a.total, scored: a.scored, matched: a.matched, eligible: a.eligible, employer: a.employer, research: a.research,
      email: a.email, warm: a.warm, routed: a.routed, route_available: a.route_available, engaged: a.engaged, deals: a.deals,
    };
    const payload: PanelPayload = {
      viewer: { user_id: session.userId, role: session.role },
      icp: { ...(icp as unknown as PanelPayload['icp']), criteria: normalizeCriteria(icp.criteria as never) },
      is_owner: owner === session.userId,
      blockers: blockersFor(icp, quota, { kill_switch: killSwitch, leads_finder_enabled: enabled.leads_finder, user_hold: userHold }, finderState),
      quota,
      policy: { kill_switch: killSwitch, enabled, leads_finder: rule['agents.leads_finder'] ?? {}, enricher: rule['agents.enricher'] ?? {} },
      fit: { strong: a.strong, proceed: a.proceed, weak: a.weak, do_not_pursue: a.do_not_pursue, unscored: a.unscored },
      stages: (a.stages ?? {}) as StageCounts,
      coverage,
      finder: {
        state: finderState,
        queued: queuedBy.leads_finder ?? 0,
        runs: runs.filter((r) => r.agent === 'leads_finder').slice(0, 10),
        daily: days,
      },
      enricher: {
        attempts_7d: attempts.rows,
        failures: failures.rows,
        runs: runs.filter((r) => r.agent === 'enricher').slice(0, 5),
        queued: queuedBy.enricher ?? 0,
      },
      graph: {
        totals: graph.rows[0]?.totals ?? { edges: 0, people: 0 },
        sync: graph.rows[0]?.sync ?? null,
        last_run: runs.find((r) => r.agent === 'graph_sync') ?? null,
        degrees: { d1: a.d1, d2: a.d2, d3: a.d3, unknown: a.unknown },
        hops: hops.rows,
        top_routed: topRouted.rows,
      },
      outreach: {
        pending: (approvals.rows as PanelApproval[]).filter((ap) => ap.status === 'pending'),
        by_status: byStatus,
        intros: { by_state: byState, open: intros.rows.filter((ir) => OPEN.has(ir.state)) },
        last_run: runs.find((r) => r.agent === 'outreach') ?? null,
      },
      activity: runs.slice(0, 40),
    };
    return NextResponse.json(payload);
  } finally {
    client.release();
  }
}
