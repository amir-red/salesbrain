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
});

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { rows } = await pool.query(
      `SELECT * FROM deals WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
      [session.userId]
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

  const { name, company, contact_name, contact_email, value } = parsed.data;
  const missing = getMissingFields(1, {});

  try {
    const { rows } = await pool.query(
      `INSERT INTO deals (name, company, contact_name, contact_email, value, missing, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, company, contact_name || null, contact_email || null, value || null, missing, session.userId]
    );
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    console.error('Failed to create deal:', err);
    return NextResponse.json({ error: 'Failed to create deal' }, { status: 500 });
  }
}
