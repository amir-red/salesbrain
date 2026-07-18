/**
 * POST /api/deals/:id/restore — un-soft-delete a deal.
 *
 * Admin-only. Deliberately stricter than deletion so a compromised
 * regular-user session can't undo an admin's cleanup pass. Deals with
 * cascade-cleaned dependencies (unlikely in the current schema — we use
 * ON DELETE CASCADE only for hard deletes) come back with their full
 * history intact because we never actually removed the row.
 */
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can restore deleted deals' }, { status: 403 });
  }

  const { rowCount } = await pool.query(
    `UPDATE deals
     SET deleted_at = NULL, deleted_by = NULL
     WHERE id = $1 AND deleted_at IS NOT NULL`,
    [params.id],
  );

  if (rowCount === 0) {
    return NextResponse.json(
      { error: 'Deal not found or not currently deleted' },
      { status: 404 },
    );
  }

  return NextResponse.json({ restored: true, id: params.id });
}
