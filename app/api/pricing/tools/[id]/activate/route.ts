import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

/**
 * POST /api/pricing/tools/[id]/activate
 * Make this version the active one. Any authenticated user. The partial
 * unique index on pricing_tools(is_active) enforces "exactly one active";
 * we wrap in a transaction so deactivate+activate happen atomically.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify target exists
  const { rows } = await pool.query(
    `SELECT id FROM pricing_tools WHERE id = $1 LIMIT 1`, [params.id]
  );
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await pool.query('BEGIN');
  try {
    await pool.query(`UPDATE pricing_tools SET is_active = false WHERE is_active = true`);
    await pool.query(`UPDATE pricing_tools SET is_active = true WHERE id = $1`, [params.id]);
    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('[activate]', err);
    return NextResponse.json({ error: 'Failed to activate' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
