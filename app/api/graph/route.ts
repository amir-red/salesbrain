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

  const [bySource, totals, contacts, state, edges] = await Promise.all([
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
  ]);

  return NextResponse.json({
    totals: totals.rows[0] ?? { edges: 0, people: 0 },
    by_source: bySource.rows,
    contacts: contacts.rows[0] ?? { contacts: 0, bridged: 0, dated: 0 },
    sync: state.rows[0] ?? null,
    edges: edges.rows,
  });
}
