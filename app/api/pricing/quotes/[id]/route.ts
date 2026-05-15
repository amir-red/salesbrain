import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

/**
 * GET /api/pricing/quotes/[id]      — fetch one quote
 * DELETE /api/pricing/quotes/[id]   — creator or admin only
 */

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows } = await pool.query(
    `SELECT q.*, t.version as tool_version, t.filename as tool_filename,
            u.name as created_by_name
     FROM pricing_quotes q
     LEFT JOIN pricing_tools t ON t.id = q.pricing_tool_id
     LEFT JOIN users u ON u.id = q.created_by
     WHERE q.id = $1`,
    [params.id]
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows } = await pool.query(
    `SELECT created_by FROM pricing_quotes WHERE id = $1`, [params.id]
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const canDelete = session.role === 'admin' || row.created_by === session.userId;
  if (!canDelete) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await pool.query(`DELETE FROM pricing_quotes WHERE id = $1`, [params.id]);
  return NextResponse.json({ ok: true });
}
