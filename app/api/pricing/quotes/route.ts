import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

/**
 * GET /api/pricing/quotes?deal_id=…  — list quotes (optionally filtered by deal)
 * POST /api/pricing/quotes            — save a quote snapshot
 */

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dealId = req.nextUrl.searchParams.get('deal_id');
  const filters: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (dealId) { filters.push(`q.deal_id = $${i++}`); values.push(dealId); }

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT q.id, q.deal_id, q.pricing_tool_id, q.inputs, q.outputs, q.pnl, q.notes,
            q.created_at, q.created_by,
            t.version as tool_version, t.filename as tool_filename,
            u.name as created_by_name
     FROM pricing_quotes q
     LEFT JOIN pricing_tools t ON t.id = q.pricing_tool_id
     LEFT JOIN users u ON u.id = q.created_by
     ${where}
     ORDER BY q.created_at DESC LIMIT 100`,
    values
  );
  return NextResponse.json(rows);
}

const SaveSchema = z.object({
  deal_id: z.string().uuid().nullable().optional(),
  pricing_tool_id: z.string().uuid(),
  inputs: z.record(z.string(), z.unknown()),
  outputs: z.record(z.string(), z.unknown()),
  pnl: z.record(z.string(), z.unknown()).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = SaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;

  const { rows } = await pool.query(
    `INSERT INTO pricing_quotes (deal_id, pricing_tool_id, created_by, inputs, outputs, pnl, notes)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)
     RETURNING *`,
    [
      d.deal_id ?? null,
      d.pricing_tool_id,
      session.userId,
      JSON.stringify(d.inputs),
      JSON.stringify(d.outputs),
      d.pnl ? JSON.stringify(d.pnl) : null,
      d.notes ?? null,
    ]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
