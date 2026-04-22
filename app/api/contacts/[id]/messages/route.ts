import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

/**
 * Imported messages are ALWAYS private per user.
 * Admins can see all, but regular users only see their own messages (user_id match).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = session.role === 'admin';

  const userFilter = isAdmin ? '' : `AND user_id = $2`;
  const values = isAdmin ? [params.id] : [params.id, session.userId];

  const { rows } = await pool.query(
    `SELECT id, source, direction, sent_at, from_email, to_email, subject,
            LEFT(body, 2000) as body, created_at
     FROM imported_messages
     WHERE contact_id = $1 ${userFilter}
     ORDER BY COALESCE(sent_at, created_at) DESC
     LIMIT 50`,
    values
  );
  return NextResponse.json(rows);
}
