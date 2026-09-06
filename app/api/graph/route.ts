import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

/**
 * GET /api/graph — the signed-in user's relationship graph.
 *
 * Direct owner-scoped SQL rather than a kernelCall: this is a page-load read on
 * a hot path, and spawning a Python subprocess for two aggregates would cost
 * more than the query. The kernel keeps the equivalents (crm_graph_status /
 * crm_graph_edges) for the agent and the partner API.
 *
 * ?edges=N returns the N strongest first-hop connections; ?source= filters them.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('edges') ?? 50) || 50, 1), 500);
  const source = url.searchParams.get('source');

  const [bySource, totals, contacts, state, edges, reach, colleagues, teammates] = await Promise.all([
    pool.query(
      `SELECT source, count(*)::int AS edges,
              count(DISTINCT dst_person_id)::int AS people,
              round(avg(strength), 3)::float8 AS avg_strength,
              max(last_signal_at) AS newest
         FROM person_edges WHERE owner_user_id = $1
        GROUP BY source ORDER BY 2 DESC`,
      [session.userId],
    ),
    pool.query(
      `SELECT count(*)::int AS edges, count(DISTINCT dst_person_id)::int AS people
         FROM person_edges WHERE owner_user_id = $1`,
      [session.userId],
    ),
    pool.query(
      `SELECT count(*)::int AS contacts, count(person_id)::int AS bridged,
              count(connected_on)::int AS dated
         FROM contacts WHERE owner_user_id = $1`,
      [session.userId],
    ),
    pool.query(
      `SELECT phase, relations_pages_done, relations_seen, mirror_completed_at,
              last_run_at, last_error
         FROM graph_sync_state WHERE owner_user_id = $1`,
      [session.userId],
    ),
    pool.query(
      `SELECT e.source, e.strength::float8 AS strength, e.direction,
              e.last_signal_at, e.evidence,
              p.id AS person_id, p.full_name, p.organization, p.primary_email
         FROM person_edges e JOIN people p ON p.id = e.dst_person_id
        WHERE e.owner_user_id = $1 AND e.src_person_id IS NULL
          AND ($2::text IS NULL OR e.source = $2)
        ORDER BY e.strength DESC, e.last_signal_at DESC NULLS LAST
        LIMIT $3`,
      [session.userId, source, limit],
    ),
    // The second hop: everyone a connected teammate knows that I do not.
    // Aggregate only — a teammate's contact list is never returned here.
    pool.query(
      `SELECT count(DISTINCT e.dst_person_id)::int AS via
         FROM person_edges e
         JOIN users u ON u.id = e.owner_user_id AND u.person_id IS NOT NULL
        WHERE e.owner_user_id <> $1 AND e.src_person_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM person_edges mine
                           WHERE mine.owner_user_id = $1 AND mine.src_person_id IS NULL
                             AND mine.dst_person_id = e.dst_person_id)`,
      [session.userId],
    ),
    pool.query(
      `SELECT u.name,
              count(DISTINCT e.dst_person_id)::int AS ring,
              count(DISTINCT e.dst_person_id) FILTER (
                WHERE NOT EXISTS (SELECT 1 FROM person_edges mine
                                   WHERE mine.owner_user_id = $1 AND mine.src_person_id IS NULL
                                     AND mine.dst_person_id = e.dst_person_id))::int AS adds
         FROM users u
         JOIN person_edges e ON e.owner_user_id = u.id AND e.src_person_id IS NULL
        WHERE u.id <> $1 AND u.person_id IS NOT NULL
        GROUP BY u.id, u.name
        ORDER BY 3 DESC`,
      [session.userId],
    ),
    pool.query(
      `SELECT count(*)::int AS n FROM users u
        WHERE u.id <> $1
          AND NOT EXISTS (SELECT 1 FROM linkedin_accounts la
                           WHERE la.owner_user_id = u.id AND la.revoked_at IS NULL)`,
      [session.userId],
    ),
  ]);

  return NextResponse.json({
    totals: totals.rows[0] ?? { edges: 0, people: 0 },
    by_source: bySource.rows,
    contacts: contacts.rows[0] ?? { contacts: 0, bridged: 0, dated: 0 },
    sync: state.rows[0] ?? null,
    edges: edges.rows,
    reach: {
      direct: totals.rows[0]?.people ?? 0,
      via_colleagues: reach.rows[0]?.via ?? 0,
      colleagues: colleagues.rows,
      teammates_without_linkedin: teammates.rows[0]?.n ?? 0,
    },
  });
}
