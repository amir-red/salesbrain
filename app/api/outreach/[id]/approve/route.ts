import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rowCount } = await pool.query(
    `UPDATE outreach_messages SET status = 'approved', human_approved_by = $1
     WHERE id = $2 AND status = 'draft'`,
    [session.userId, params.id]
  );
  if (!rowCount) return NextResponse.json({ error: 'Message not found or not in draft state' }, { status: 404 });
  return NextResponse.json({ approved: true, message_id: params.id });
}
