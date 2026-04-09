import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows } = await pool.query(
    `SELECT
       company,
       COUNT(*)::int as deal_count,
       MAX(value) as max_deal_value,
       MAX(gate)::int as highest_gate_reached,
       MAX(score)::int as best_score,
       MAX(COALESCE(updated_at, created_at)) as last_activity,
       (array_agg(currency ORDER BY value DESC NULLS LAST))[1] as currency
     FROM deals
     WHERE user_id = $1
     GROUP BY company
     ORDER BY last_activity DESC`,
    [session.userId]
  );

  return NextResponse.json(rows);
}
