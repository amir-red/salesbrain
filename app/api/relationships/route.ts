import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/relationships
 * The relationship graph, list view: every person with a relationship row,
 * plus the counts the attention allocator scores on. Read-only — the graph
 * is written exclusively through the kernel (agent tools / distill), never
 * from this UI. Org-wide visibility: relationships belong to the company,
 * not to an owner (unlike deals).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows } = await pool.query(`
    SELECT p.id, p.full_name, p.organization, r.stage, r.preferred_channel,
           r.cadence_days, r.last_interaction_at,
           (SELECT COALESCE(json_agg(json_build_object('channel', h.channel, 'handle', h.handle)), '[]'::json)
              FROM channel_handles h WHERE h.person_id = p.id) AS handles,
           (SELECT count(*)::int FROM commitments c
              WHERE c.person_id = p.id AND c.status = 'open') AS open_commitments,
           (SELECT count(*)::int FROM person_facts f
              WHERE f.person_id = p.id AND f.superseded_at IS NULL) AS facts,
           (SELECT count(*)::int FROM value_events v WHERE v.person_id = p.id) AS value_events,
           (SELECT count(*)::int FROM objectives o
              WHERE o.person_id = p.id AND o.status = 'active') AS objectives,
           (SELECT count(*)::int FROM deals d
              WHERE d.relationship_person_id = p.id AND d.deleted_at IS NULL) AS deals
    FROM people p
    JOIN relationships r ON r.person_id = p.id
    ORDER BY r.last_interaction_at DESC NULLS LAST, p.full_name
  `);

  return NextResponse.json({ people: rows });
}
