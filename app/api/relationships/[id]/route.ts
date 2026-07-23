import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/relationships/:id
 * Full dossier for one person — the same picture the agent gets injected
 * (facts WITH provenance, commitments, value ledger, objectives, timeline),
 * so a human reviewing an allocator digest sees exactly what the agent saw.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const person = (await pool.query(
    `SELECT p.id, p.full_name, p.organization, r.stage, r.preferred_channel,
            r.cadence_days, r.last_interaction_at
     FROM people p JOIN relationships r ON r.person_id = p.id WHERE p.id = $1`,
    [id],
  )).rows[0];
  if (!person) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [handles, facts, commitments, valueEvents, objectives, interactions, deals] =
    await Promise.all([
      pool.query(`SELECT channel, handle FROM channel_handles WHERE person_id = $1`, [id]),
      // Provenance (source + learned_at) is deliberately part of the payload —
      // every fact must be attributable, and superseded history stays visible.
      pool.query(
        `SELECT fact, source, learned_at, superseded_at
         FROM person_facts WHERE person_id = $1 ORDER BY learned_at DESC`, [id]),
      pool.query(
        `SELECT direction, description, due_at, status, created_at, resolved_at
         FROM commitments WHERE person_id = $1
         ORDER BY (status = 'open') DESC, due_at NULLS LAST`, [id]),
      pool.query(
        `SELECT tier, description, occurred_at
         FROM value_events WHERE person_id = $1 ORDER BY occurred_at DESC`, [id]),
      pool.query(
        `SELECT description, target_tier, status, created_at
         FROM objectives WHERE person_id = $1 ORDER BY (status = 'active') DESC, created_at DESC`,
        [id]),
      pool.query(
        `SELECT occurred_at, channel, direction, summary
         FROM interactions WHERE person_id = $1 ORDER BY occurred_at DESC LIMIT 50`, [id]),
      pool.query(
        `SELECT id, name, gate, status, deal_type
         FROM deals WHERE relationship_person_id = $1 AND deleted_at IS NULL
         ORDER BY updated_at DESC`, [id]),
    ]);

  return NextResponse.json({
    person,
    handles: handles.rows,
    facts: facts.rows,
    commitments: commitments.rows,
    value_events: valueEvents.rows,
    objectives: objectives.rows,
    interactions: interactions.rows,
    deals: deals.rows,
  });
}
