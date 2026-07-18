import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { getMissingFields } from '@/lib/gates';
import { getSession } from '@/lib/auth';

const CreateDealSchema = z.object({
  name: z.string().min(1).max(255),
  company: z.string().min(1).max(255),
  contact_name: z.string().optional(),
  contact_email: z.string().email().optional(),
  value: z.number().optional(),
  deal_type: z.enum(['sales', 'grant']).default('sales'),
});

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Admins see all deals. Regular users see deals where they are either
    // the creator (user_id) OR the assigned project lead (lead_id) — so a
    // teammate-created deal that names you as lead is visible to you.
    const isAdmin = session.role === 'admin';
    // Every list query filters out soft-deleted deals. Admins can view
    // deleted rows via GET /api/deals/[id]?include_deleted=1 for restore.
    const { rows } = await pool.query(
      `SELECT d.*, u.name as lead_name, u.email as lead_email
       FROM deals d
       LEFT JOIN users u ON u.id = d.lead_id
       WHERE d.deleted_at IS NULL
       ${isAdmin ? '' : 'AND (d.user_id = $1 OR d.lead_id = $1)'}
       ORDER BY d.updated_at DESC LIMIT 100`,
      isAdmin ? [] : [session.userId]
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error('Failed to fetch deals:', err);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CreateDealSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const { name, company, contact_name, contact_email, value, deal_type } = parsed.data;
  const missing = getMissingFields(1, {}, deal_type);

  try {
    const { rows } = await pool.query(
      `INSERT INTO deals (name, company, contact_name, contact_email, value, missing, user_id, deal_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [name, company, contact_name || null, contact_email || null, value || null, missing, session.userId, deal_type]
    );
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    console.error('Failed to create deal:', err);
    return NextResponse.json({ error: 'Failed to create deal' }, { status: 500 });
  }
}
