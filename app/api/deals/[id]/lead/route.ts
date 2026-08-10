/**
 * PUT /api/deals/:id/lead
 *
 * Body: { lead_id: string | null }
 *
 * Reassign the deal's project lead ("Assigned Person" in the grant spec).
 * Permission: admin, current lead, or creator — same rule as the deal
 * detail-page + chat surfaces. Previously this endpoint had ZERO check,
 * so any authenticated user could reassign any deal (see grant Stage 2
 * plan).
 *
 * Also records the change into `deal_lead_history` so donor-continuity
 * work has an audit trail (mirrors what sign_grant_agreement does at
 * signature). This route only runs when reassigning OUTSIDE the signature
 * flow — for a signature-time handover, use POST /api/deals/:id/sign.
 */
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  let body: { lead_id: string | null; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Permission check — mirror lib/mcp/tool-dispatch dealVisibility rule.
  // Admins reassign anything; others only their own or a deal they lead.
  const current = await pool.query<{ user_id: string; lead_id: string | null }>(
    `SELECT user_id, lead_id FROM deals WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (current.rows.length === 0) {
    return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
  }
  const row = current.rows[0];
  const isAllowed =
    session.role === 'admin' ||
    row.user_id === session.userId ||
    row.lead_id === session.userId;
  if (!isAllowed) {
    return NextResponse.json({ error: 'Not authorized to reassign this deal' }, { status: 403 });
  }

  const prevLeadId = row.lead_id;
  const { rows } = await pool.query(
    `UPDATE deals SET lead_id = $1 WHERE id = $2 RETURNING id, lead_id`,
    [body.lead_id, id],
  );

  // Audit only real changes. Setting the same lead again is a no-op.
  if (prevLeadId !== body.lead_id) {
    await pool.query(
      `INSERT INTO deal_lead_history (deal_id, prev_lead_id, new_lead_id, reason, changed_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, prevLeadId, body.lead_id, body.reason ?? 'reassigned via UI', session.userId],
    );
  }

  return NextResponse.json(rows[0]);
}
