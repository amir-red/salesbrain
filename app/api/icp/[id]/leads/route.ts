import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { visibleIcp } from '@/lib/icp-server';

/**
 * The ICP's list: every prospect the Leads Finder (or a manual search / import)
 * attached to this ICP, best fit first, plus the agent's cursor state and the
 * last run — what the Gojiberry "Leads" tab shows.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Owner or admin may read; prospects are scoped by the ICP's OWNER, not the
  // session, so an admin opening a colleague's list sees the colleague's leads.
  const icp = await visibleIcp(params.id, session);
  if (!icp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const own = { rows: [{ id: icp.id, name: icp.name }] };

  const stage = req.nextUrl.searchParams.get('stage');
  const minScore = Number(req.nextUrl.searchParams.get('min_score') || 0);
  const warm = req.nextUrl.searchParams.get('warm') === '1';
  const values: unknown[] = [params.id, icp.owner_user_id];
  const filters: string[] = [`p.icp_profile_id = $1`, `(p.owner_user_id = $2 OR p.owner_user_id IS NULL)`];
  if (stage) { values.push(stage); filters.push(`p.stage = $${values.length}`); }
  if (minScore > 0) { values.push(minScore); filters.push(`p.icp_score >= $${values.length}`); }
  if (warm) filters.push(`(p.network_degree IN ('1','2') OR jsonb_array_length(COALESCE(p.warm_paths, '[]'::jsonb)) > 0)`);

  const [leads, state, last, counts] = await Promise.all([
    pool.query(
      `SELECT p.id, p.stage, p.icp_score, p.fit_label, p.qualification_reason, p.research_summary,
              p.source_type, p.source_detail, p.linkedin_public_id, p.candidate_location,
              p.network_degree, p.warm_paths, p.priority_rank,
              p.created_at, p.scored_at, p.engaged_at, p.converted_deal_id,
              c.full_name, c.title, c.email, c.linkedin_url,
              a.name AS company_name, a.industry, a.company_size,
              inv.status AS invite_status, inv.sent_at AS invite_sent_at, inv.source AS invite_source,
              inv.error AS invite_error,
              (SELECT oa.status FROM outreach_approvals oa
                WHERE oa.prospect_id = p.id AND oa.kind = 'connect'
                  AND oa.status IN ('pending', 'approved') LIMIT 1) AS connect_approval
       FROM prospects p
       LEFT JOIN contacts c ON c.id = p.contact_id
       LEFT JOIN accounts a ON a.id = p.account_id
       -- the newest connection request to this person, sent by us or by hand
       LEFT JOIN LATERAL (
         SELECT i.status, i.sent_at, i.source, i.error FROM linkedin_invitations i
          WHERE i.owner_user_id = p.owner_user_id
            AND (i.prospect_id = p.id OR lower(i.public_identifier) = lower(p.linkedin_public_id)
                 OR i.provider_id = p.linkedin_member_id)
          ORDER BY i.sent_at DESC LIMIT 1) inv ON true
       WHERE ${filters.join(' AND ')}
       -- a hand-ranked list is worked in its own order (050); fit decides the rest
       ORDER BY p.priority_rank NULLS LAST, p.icp_score DESC NULLS LAST, p.created_at DESC LIMIT 300`,
      values,
    ),
    pool.query(`SELECT * FROM icp_agent_state WHERE icp_profile_id = $1`, [params.id]),
    pool.query(
      `SELECT id, status, trigger, source, started_at, finished_at, analyzed, matched, created, researched, detail, error
       FROM agent_runs WHERE icp_profile_id = $1 AND status <> 'requested' ORDER BY started_at DESC LIMIT 1`,
      [params.id],
    ),
    pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE fit_label = 'strong_fit')::int AS strong,
              count(*) FILTER (WHERE fit_label = 'proceed_with_caution')::int AS proceed,
              count(*) FILTER (WHERE research_summary IS NOT NULL)::int AS researched,
              count(*) FILTER (WHERE engaged_at IS NOT NULL)::int AS engaged,
              count(*) FILTER (WHERE stage IN ('P8_DISQUALIFIED','P9_ARCHIVED'))::int AS archived
       FROM prospects p WHERE p.icp_profile_id = $1 AND (p.owner_user_id = $2 OR p.owner_user_id IS NULL)`,
      [params.id, icp.owner_user_id],
    ),
  ]);
  const pending = await pool.query(
    `SELECT count(*)::int AS n FROM agent_runs WHERE icp_profile_id = $1 AND status = 'requested'`, [params.id]);
  // What the connect cap still allows today, for the "queue next" button.
  const connect = await pool.query(
    `SELECT (SELECT value FROM policy_rules WHERE key = 'agents.linkedin_connect') AS cfg,
            la.id IS NOT NULL AS linkedin,
            (SELECT count(*)::int FROM linkedin_invitations i
              WHERE i.account_id = la.id AND i.status <> 'failed' AND i.sent_at > now() - interval '24 hours') AS sent_today,
            (SELECT count(*)::int FROM linkedin_invitations i
              WHERE i.account_id = la.id AND i.status <> 'failed' AND i.sent_at > now() - interval '7 days') AS sent_week,
            (SELECT count(*)::int FROM outreach_approvals oa
              WHERE oa.owner_user_id = $1 AND oa.kind = 'connect' AND oa.status IN ('pending', 'approved')) AS queued
       FROM (SELECT 1) one
       LEFT JOIN linkedin_accounts la ON la.owner_user_id = $1 AND la.revoked_at IS NULL`,
    [icp.owner_user_id]);
  const cc = connect.rows[0] ?? {};
  const cfg = { enabled: true, per_day: 5, per_week: 25, no_answer_after_days: 21, ...(cc.cfg ?? {}) };
  return NextResponse.json({
    icp: own.rows[0], leads: leads.rows, counts: counts.rows[0],
    agent_state: state.rows[0] ?? null, last_run: last.rows[0] ?? null,
    queued_runs: pending.rows[0]?.n ?? 0,
    connect: {
      linkedin: Boolean(cc.linkedin), enabled: Boolean(cfg.enabled),
      per_day: Number(cfg.per_day), per_week: Number(cfg.per_week),
      no_answer_after_days: Number(cfg.no_answer_after_days),
      sent_today: cc.sent_today ?? 0, sent_week: cc.sent_week ?? 0, queued: cc.queued ?? 0,
    },
  });
}
