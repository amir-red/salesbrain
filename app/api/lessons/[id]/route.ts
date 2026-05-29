/**
 * DELETE /api/lessons/:id
 *
 * Permission: lesson creator OR admin. Org-wide read; restricted delete.
 *
 * NOTE: this does NOT un-lose the deal. If someone deletes a lesson, the
 * deal's status='lost' stays. That's intentional — deleting a "bad" lesson
 * (e.g. wrong root cause) should let the user re-record without altering
 * the underlying deal state. To revive a deal entirely, a future
 * "reopen-deal" endpoint will own that flow.
 */
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const isAdmin = session.role === 'admin';
  const sql = isAdmin
    ? 'DELETE FROM lessons_learned WHERE id = $1 RETURNING id'
    : 'DELETE FROM lessons_learned WHERE id = $1 AND created_by = $2 RETURNING id';
  const params_ = isAdmin ? [id] : [id, session.userId];

  const { rowCount } = await pool.query(sql, params_);
  if (rowCount === 0) {
    return NextResponse.json({ error: 'Not found or not allowed' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
