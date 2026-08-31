import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

/**
 * The ICP's list: every prospect the Leads Finder (or a manual search / import)
 * attached to this ICP, best fit first, plus the agent's cursor state and the
 * last run — what the Gojiberry "Leads" tab shows.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const own = await pool.query(`SELECT id, name FROM icp_profiles WHERE id = $1 AND owner_user_id = $2`, [params.id, session.userId]);
  if (!own.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const stage = req.nextUrl.searchParams.get('stage');
  const minScore = Number(req.nextUrl.searchParams.get('min_score') || 0);
  const warm = req.nextUrl.searchParams.get('warm') === '1';
  const values: unknown[] = [params.id, session.userId];
  const filters: string[] = [`p.icp_profile_id = $1`, `(p.owner_user_id = $2 OR p.owner_user_id IS NULL)`];
  if (stage) { values.push(stage); filters.push(`p.stage = $${values.length}`); }
  if (minScore > 0) { values.push(minScore); filters.push(`p.icp_score >= $${values.length}`); }
  if (warm) filters.push(`(p.network_degree IN ('1','2') OR jsonb_array_length(COALESCE(p.warm_paths, '[]'::jsonb)) > 0)`);

  const [leads, state, last, counts] = await Promise.all([
    pool.query(
      `SELECT p.id, p.stage, p.icp_score, p.fit_label, p.qualification_reason, p.research_summary,
              p.source_type, p.source_detail, p.linkedin_public_id, p.candidate_location,
              p.network_degree, p.warm_paths,
              p.created_at, p.scored_at, p.engaged_at, p.converted_deal_id,
              c.full_name, c.title, c.email, c.linkedin_url,
              a.name AS company_name, a.industry, a.company_size
       FROM prospects p
       LEFT JOIN contacts c ON c.id = p.contact_id
       LEFT JOIN accounts a ON a.id = p.account_id
       WHERE ${filters.join(' AND ')}
       ORDER BY p.icp_score DESC NULLS LAST, p.created_at DESC LIMIT 300`,
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
      [params.id, session.userId],
    ),
  ]);
  const pending = await pool.query(
    `SELECT count(*)::int AS n FROM agent_runs WHERE icp_profile_id = $1 AND status = 'requested'`, [params.id]);
  return NextResponse.json({
    icp: own.rows[0], leads: leads.rows, counts: counts.rows[0],
    agent_state: state.rows[0] ?? null, last_run: last.rows[0] ?? null,
    queued_runs: pending.rows[0]?.n ?? 0,
  });
}
