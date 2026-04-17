import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify access: admins can see all, regular users only their own deals
  const isAdmin = session.role === 'admin';
  const { rows: dealRows } = await pool.query(
    isAdmin
      ? 'SELECT id FROM deals WHERE id = $1'
      : 'SELECT id FROM deals WHERE id = $1 AND user_id = $2',
    isAdmin ? [params.dealId] : [params.dealId, session.userId]
  );
  if (dealRows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { rows } = await pool.query(
    `SELECT role, content, tool_name, created_at
     FROM conversations
     WHERE deal_id = $1 AND role IN ('user', 'assistant')
     ORDER BY created_at ASC
     LIMIT 100`,
    [params.dealId]
  );

  return NextResponse.json(rows);
}
