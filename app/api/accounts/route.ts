import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { normalizeDomain } from '@/lib/prospecting';

const CreateAccountSchema = z.object({
  name: z.string().min(1).max(255),
  domain: z.string().optional(),
  website: z.string().optional(),
  industry: z.string().optional(),
  company_size: z.string().optional(),
  hq_location: z.string().optional(),
  notes: z.string().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows } = await pool.query(
    `SELECT a.*,
       (SELECT COUNT(*)::int FROM contacts WHERE account_id = a.id) as contact_count,
       (SELECT COUNT(*)::int FROM prospects WHERE account_id = a.id) as prospect_count,
       (SELECT COUNT(*)::int FROM deals WHERE LOWER(company) = LOWER(a.name) AND deleted_at IS NULL) as deal_count
     FROM accounts a
     ORDER BY a.updated_at DESC LIMIT 200`
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
  const parsed = CreateAccountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;
  const domain = normalizeDomain(d.domain);

  const { rows } = await pool.query(
    `INSERT INTO accounts (name, domain, website, industry, company_size, hq_location, notes, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual') RETURNING *`,
    [d.name, domain, d.website || null, d.industry || null, d.company_size || null, d.hq_location || null, d.notes || null]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
