import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

const PatchSchema = z.object({
  mark_contacted: z.boolean().optional(),  // touch last_contacted_at on linked prospect
  notes: z.string().max(5000).optional(),
  title: z.string().max(255).optional(),
  phone: z.string().max(64).optional(),
  email: z.string().email().optional(),
  linkedin_url: z.string().max(512).optional(),
});

/**
 * GET /api/contacts/[id] — single contact with company name.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = session.role === 'admin';

  const filter = isAdmin ? '' : ' AND (c.owner_user_id = $2 OR c.owner_user_id IS NULL)';
  const values = isAdmin ? [params.id] : [params.id, session.userId];
  const { rows } = await pool.query(
    `SELECT c.*, a.name as company_name, a.industry as company_industry, a.hq_location as company_location
     FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id
     WHERE c.id = $1${filter}`,
    values
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

/**
 * PATCH /api/contacts/[id]
 * Supports: { mark_contacted?: boolean, notes?, title?, phone?, email?, linkedin_url? }
 * - mark_contacted: bumps last_contacted_at on the contact's linked prospect (if any).
 * - other fields update the contact row directly.
 *
 * Per-user scoping: regular users can only update contacts they own (or legacy NULL-owner).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = session.role === 'admin';

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;

  // Verify contact ownership
  const ownerFilter = isAdmin ? '' : ' AND (owner_user_id = $2 OR owner_user_id IS NULL)';
  const ownerValues = isAdmin ? [params.id] : [params.id, session.userId];
  const { rows: existing } = await pool.query(
    `SELECT id FROM contacts WHERE id = $1${ownerFilter}`,
    ownerValues
  );
  if (existing.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Build dynamic UPDATE for direct fields
  const updates: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (d.notes !== undefined)        { updates.push(`notes = $${i++}`);        values.push(d.notes); }
  if (d.title !== undefined)        { updates.push(`title = $${i++}`);        values.push(d.title); }
  if (d.phone !== undefined)        { updates.push(`phone = $${i++}`);        values.push(d.phone); }
  if (d.email !== undefined)        { updates.push(`email = $${i++}`);        values.push(d.email); }
  if (d.linkedin_url !== undefined) { updates.push(`linkedin_url = $${i++}`); values.push(d.linkedin_url); }

  if (updates.length > 0) {
    values.push(params.id);
    await pool.query(`UPDATE contacts SET ${updates.join(', ')} WHERE id = $${i}`, values);
  }

  let prospectTouched = false;
  if (d.mark_contacted) {
    // Bump the most recent linked prospect's last_contacted_at.
    const prospectScopeFilter = isAdmin ? '' : ' AND (owner_user_id = $2 OR owner_user_id IS NULL)';
    const prospectValues = isAdmin ? [params.id] : [params.id, session.userId];
    const r = await pool.query(
      `UPDATE prospects SET last_contacted_at = now()
       WHERE id = (
         SELECT id FROM prospects WHERE contact_id = $1${prospectScopeFilter}
         ORDER BY updated_at DESC LIMIT 1
       )
       RETURNING id`,
      prospectValues
    );
    prospectTouched = r.rows.length > 0;
  }

  const { rows: updated } = await pool.query(
    `SELECT c.*, a.name as company_name FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`,
    [params.id]
  );
  return NextResponse.json({ ...updated[0], prospect_touched: prospectTouched });
}
