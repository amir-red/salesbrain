import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { visibleIcp } from '@/lib/icp-server';
import { cohortsStored } from '@/lib/cohorts-server';
import { TRUST_COLS, TRUST_NULL_COLS, trustStored } from '@/lib/trust-server';
import { connectQuota, type ConnectQuota } from '@/lib/connect-quota-server';

/**
 * The ICP's list: every prospect the Leads Finder (or a manual search / import)
 * attached to this ICP, best fit first, plus the agent's cursor state and the
 * last run — what the Gojiberry "Leads" tab shows.
 *
 * SLIM ROWS (2026-10-28, list-speed): the row carries only what the table draws — the research text, the
 * qualification reasons and the full profile-lookup detail (candidates) live on GET /api/icp/[id]/leads/[leadId],
 * fetched when a row is expanded. Before this one list was 1.1 MB (research 350 KB, candidates 290 KB) and took
 * 15–25 s to arrive; now ~100 KB. The ranked page is picked FIRST (`base`), then the per-row laterals run over
 * those 300 rows, not the whole list. One checked-out client, queries in sequence (pooler rule).
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
  // the one person priority (091): 'set' = any priority, 'top' = P1-P3, '1'..'10' = that level, 'none' = unset
  const prio = req.nextUrl.searchParams.get('priority') || '';
  // Every lead on the list, whoever holds it (a lead can sit with the account that sends to it).
  const values: unknown[] = [params.id];
  const filters: string[] = [`p.icp_profile_id = $1`];
  if (stage) { values.push(stage); filters.push(`p.stage = $${values.length}`); }
  if (minScore > 0) { values.push(minScore); filters.push(`p.icp_score >= $${values.length}`); }
  if (warm) filters.push(`(p.network_degree IN ('1','2') OR jsonb_array_length(COALESCE(p.warm_paths, '[]'::jsonb)) > 0)`);
  if (prio === 'set') filters.push('p.priority IS NOT NULL');
  else if (prio === 'top') filters.push('p.priority <= 3');
  else if (prio === 'none') filters.push('p.priority IS NULL');
  else if (/^(10|[1-9])$/.test(prio)) { values.push(Number(prio)); filters.push(`p.priority = $${values.length}`); }

  // Cohorts (090): where the sorter placed the person (its guess and confidence) and the company's short summary.
  const cohorts = await cohortsStored();
  const cohortCols = cohorts
    ? `cs.signals AS cohort_signals, cs.guess_key AS cohort_guess, cs.confidence AS cohort_confidence,
       COALESCE(ap.profile ->> 'summary', cs.verdict ->> 'summary') AS company_summary,
       COALESCE(ap.profile -> 'facts', cs.verdict -> 'facts') AS company_facts,`
    : '';
  const cohortJoin = cohorts
    ? `LEFT JOIN cohort_scores cs ON cs.prospect_id = p.id
       LEFT JOIN account_profiles ap ON ap.account_id = p.account_id AND ap.kind = 'company'`
    : '';
  // The trust score (095) is THE rank: a hand-set priority first, then the score; the list's own order and the fit
  // score only break ties (and order everything before 095 exists).
  const trust = await trustStored();
  const trustJoin = trust ? 'LEFT JOIN trust_scores ts ON ts.prospect_id = p.id' : '';
  const order = [
    'p.priority NULLS LAST',
    trust ? 'ts.total DESC NULLS LAST' : '',
    'p.priority_rank NULLS LAST, p.icp_score DESC NULLS LAST, p.created_at DESC',
  ].filter(Boolean).join(', ');

  const client = await pool.connect();
  let leads, state, last, counts, pending, connect: ConnectQuota | undefined;
  try {
    leads = await client.query(
      `WITH base AS (
         SELECT p.* FROM leads p -- the one table (088): the prospects view lacks the card columns such as priority
         ${trustJoin}
         WHERE ${filters.join(' AND ')}
         -- the trust score ranks (authority, trust path, fit, openness); a hand-ranked list in its own order (050)
         ORDER BY ${order} LIMIT 300)
       SELECT ${cohortCols} ${trust ? TRUST_COLS : TRUST_NULL_COLS}, p.id, p.stage, p.icp_score, p.fit_label,
              (p.research_summary IS NOT NULL) AS researched,
              p.source_type, p.source_detail, p.linkedin_public_id, p.candidate_location,
              p.network_degree, p.warm_paths, p.priority_rank, p.priority, p.must_talk,
              p.created_at, p.scored_at, p.engaged_at, p.converted_deal_id,
              c.full_name, c.title, c.email, c.linkedin_url,
              a.name AS company_name, a.industry, a.company_size,
              inv.status AS invite_status, inv.sent_at AS invite_sent_at, inv.source AS invite_source,
              inv.error AS invite_error,
              (SELECT oa.status FROM outreach_approvals oa
                WHERE oa.prospect_id = p.id AND oa.kind = 'connect'
                  AND oa.status IN ('pending', 'approved') LIMIT 1) AS connect_approval,
              -- the newest "find the profile by name" attempt, for leads without one (051): the verdict and the
              -- counts only; the candidates themselves come with the lead's detail
              CASE WHEN p.linkedin_public_id IS NULL AND lk.result IS NOT NULL THEN jsonb_build_object(
                'result', lk.result, 'reason', lk.detail->>'reason', 'created_at', lk.created_at,
                'candidate_count', jsonb_array_length(COALESCE(lk.detail->'candidates', '[]'::jsonb)),
                'strong_count', jsonb_array_length(COALESCE(lk.detail->'strong', '[]'::jsonb)),
                'duplicate_of', lk.detail->>'duplicate_of', 'rung', lk.detail->>'rung',
                'discovered', (SELECT COALESCE(jsonb_agg(d->'name'), '[]'::jsonb) FROM jsonb_array_elements(COALESCE(lk.detail->'discovered', '[]'::jsonb)) d
                               WHERE (d->>'landed')::boolean)) END AS profile_lookup
       FROM base p
       LEFT JOIN contacts c ON c.id = p.contact_id
       LEFT JOIN accounts a ON a.id = p.account_id
       -- the newest connection request to this person, sent by us or by hand
       LEFT JOIN LATERAL (
         SELECT i.status, i.sent_at, i.source, i.error FROM linkedin_invitations i
          WHERE i.owner_user_id = p.owner_user_id
            AND (i.prospect_id = p.id OR lower(i.public_identifier) = lower(p.linkedin_public_id)
                 OR i.provider_id = p.linkedin_member_id)
          ORDER BY i.sent_at DESC LIMIT 1) inv ON true
       LEFT JOIN LATERAL (
         SELECT e.result, e.detail, e.created_at FROM prospect_enrichment e
          WHERE e.prospect_id = p.id AND e.kind = 'linkedin'
          ORDER BY e.created_at DESC LIMIT 1) lk ON true
       ${cohortJoin}
       ${trustJoin}
       ORDER BY ${order}`,
      values,
    );
    state = await client.query(`SELECT * FROM icp_agent_state WHERE icp_profile_id = $1`, [params.id]);
    last = await client.query(
      `SELECT id, status, trigger, source, started_at, finished_at, analyzed, matched, created, researched, detail, error
       FROM agent_runs WHERE icp_profile_id = $1 AND status <> 'requested' ORDER BY started_at DESC LIMIT 1`,
      [params.id],
    );
    counts = await client.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE fit_label = 'strong_fit')::int AS strong,
              count(*) FILTER (WHERE fit_label = 'proceed_with_caution')::int AS proceed,
              count(*) FILTER (WHERE research_summary IS NOT NULL)::int AS researched,
              count(*) FILTER (WHERE engaged_at IS NOT NULL)::int AS engaged,
              count(*) FILTER (WHERE stage IN ('P8_DISQUALIFIED','P9_ARCHIVED'))::int AS archived
       FROM leads p WHERE p.icp_profile_id = $1`,
      [params.id],
    );
    pending = await client.query(
      `SELECT count(*)::int AS n FROM agent_runs WHERE icp_profile_id = $1 AND status = 'requested'`, [params.id]);
    connect = await connectQuota(client, icp.owner_user_id);
  } finally {
    client.release();
  }
  return NextResponse.json({
    icp: own.rows[0], leads: leads.rows, counts: counts.rows[0],
    cohort: (icp as { cohort?: unknown }).cohort ?? null,
    agent_state: state.rows[0] ?? null, last_run: last.rows[0] ?? null,
    queued_runs: pending.rows[0]?.n ?? 0,
    connect,
  });
}
