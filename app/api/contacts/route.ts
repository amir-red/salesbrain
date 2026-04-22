import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

const CreateContactSchema = z.object({
  account_id: z.string().uuid(),
  full_name: z.string().min(1),
  email: z.string().email().optional(),
  title: z.string().optional(),
  seniority: z.string().optional(),
  persona_type: z.string().optional(),
  phone: z.string().optional(),
  linkedin_url: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * Visibility: contacts are PRIVATE per user.
 * - Regular users: see only their own contacts (owner_user_id = session.userId)
 *   + legacy contacts (owner_user_id IS NULL) so nothing breaks.
 * - Admins: see all.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = session.role === 'admin';

  const accountId = req.nextUrl.searchParams.get('account_id');
  const filters: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (accountId) {
    filters.push(`account_id = $${i++}`);
    values.push(accountId);
  }
  if (!isAdmin) {
    filters.push(`(owner_user_id = $${i++} OR owner_user_id IS NULL)`);
    values.push(session.userId);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM contacts ${where} ORDER BY updated_at DESC LIMIT 200`,
    values
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
  const parsed = CreateContactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;
  const parts = d.full_name.trim().split(/\s+/);

  const { rows } = await pool.query(
    `INSERT INTO contacts (account_id, full_name, first_name, last_name, email, title, seniority, persona_type, phone, linkedin_url, notes, source, owner_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manual', $12) RETURNING *`,
    [
      d.account_id, d.full_name, parts[0], parts.slice(1).join(' ') || null,
      d.email || null, d.title || null, d.seniority || null, d.persona_type || null,
      d.phone || null, d.linkedin_url || null, d.notes || null,
      session.userId,
    ]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
