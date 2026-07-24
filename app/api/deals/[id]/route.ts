import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Admins can view soft-deleted deals (needed for the trash / restore UI).
  // Everyone else: 404 on deleted rows.
  const includeDeleted = req.nextUrl.searchParams.get('include_deleted') === '1' && session.role === 'admin';

  try {
    // Detail page is org-wide so cards on /pipeline stay clickable.
    // Write/edit operations on the deal still gate on creator/lead/admin
    // in their respective endpoints.
    const { rows } = await pool.query(
      `SELECT d.*, u.name as lead_name, u.email as lead_email,
              del_u.name as deleted_by_name,
              lp.full_name as linked_contact_name, lp.organization as linked_contact_org
       FROM deals d
       LEFT JOIN users u ON u.id = d.lead_id
       LEFT JOIN users del_u ON del_u.id = d.deleted_by
       LEFT JOIN people lp ON lp.id = d.relationship_person_id
       WHERE d.id = $1 ${includeDeleted ? '' : 'AND d.deleted_at IS NULL'}`,
      [params.id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error('Failed to fetch deal:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * DELETE /api/deals/:id — soft-delete a deal.
 *
 * Permission: deal creator (user_id), assigned lead (lead_id), or admin.
 * Same permission model as mark-lost and the deal-chat write flows.
 *
 * Sets deleted_at + deleted_by; row stays in the DB with all related
 * history (conversations, gate_events, onboardings, etc.). Only admins
 * can restore.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const permClause =
    session.role === 'admin'
      ? '' // Admins can delete any deal
      : 'AND (user_id = $2 OR lead_id = $2)';
  const permParams = session.role === 'admin' ? [params.id] : [params.id, session.userId];

  const { rowCount } = await pool.query(
    `UPDATE deals
     SET deleted_at = now(), deleted_by = $${session.role === 'admin' ? 2 : 3}
     WHERE id = $1
       AND deleted_at IS NULL
       ${permClause}`,
    session.role === 'admin' ? [...permParams, session.userId] : [...permParams, session.userId],
  );

  if (rowCount === 0) {
    return NextResponse.json(
      { error: 'Deal not found, already deleted, or you don\'t have permission to delete it' },
      { status: 404 },
    );
  }

  return NextResponse.json({ deleted: true, id: params.id });
}
