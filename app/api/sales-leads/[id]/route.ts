/**
 * Internal API for a single sales lead.
 *
 *   PATCH /api/sales-leads/:id   — update status (new|contacted|archived)
 *                                  (use /convert to flip to 'converted')
 *   DELETE /api/sales-leads/:id  — remove a lead entirely (e.g. spam)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

const PatchSchema = z.object({
  status: z.enum(['new', 'contacted', 'archived']),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const { rowCount } = await pool.query(
    `UPDATE sales_leads SET status = $1
     WHERE id = $2 AND status != 'converted'`,    // never auto-undo a conversion
    [parsed.data.status, id],
  );

  if (rowCount === 0) {
    return NextResponse.json({ error: 'Lead not found or already converted' }, { status: 404 });
  }
  return NextResponse.json({ updated: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  const { id } = await params;
  await pool.query('DELETE FROM sales_leads WHERE id = $1', [id]);
  return NextResponse.json({ deleted: true });
}
