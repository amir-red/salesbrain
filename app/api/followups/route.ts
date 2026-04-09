import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

const CreateFollowupSchema = z.object({
  deal_id: z.string().uuid(),
  type: z.enum(['email', 'reminder', 'sla_alert']),
  subject: z.string().optional(),
  body: z.string().min(1),
  to_email: z.string().email().optional(),
  due_at: z.string(),
});

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows } = await pool.query(
    `SELECT f.*, d.name as deal_name, d.gate
     FROM followups f
     JOIN deals d ON d.id = f.deal_id
     WHERE d.user_id = $1
     ORDER BY f.due_at ASC`,
    [session.userId]
  );

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CreateFollowupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
  }

  const { deal_id, type, subject, body: content, to_email, due_at } = parsed.data;

  // Verify deal belongs to user
  const { rows: dealRows } = await pool.query(
    'SELECT id FROM deals WHERE id = $1 AND user_id = $2',
    [deal_id, session.userId]
  );
  if (dealRows.length === 0) {
    return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
  }

  const { rows } = await pool.query(
    `INSERT INTO followups (deal_id, type, subject, body, to_email, due_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [deal_id, type, subject || null, content, to_email || null, due_at]
  );

  return NextResponse.json(rows[0], { status: 201 });
}
