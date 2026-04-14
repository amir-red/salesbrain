import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { rows } = await pool.query(
      `SELECT d.*, u.name as lead_name, u.email as lead_email
       FROM deals d
       LEFT JOIN users u ON u.id = d.lead_id
       WHERE d.id = $1 AND d.user_id = $2`,
      [params.id, session.userId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error('Failed to fetch deal:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
