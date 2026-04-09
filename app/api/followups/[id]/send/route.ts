import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { sendEmail } from '@/lib/email';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Find followup and verify ownership through deal
  const { rows } = await pool.query(
    `SELECT f.*, d.name as deal_name
     FROM followups f
     JOIN deals d ON d.id = f.deal_id
     WHERE f.id = $1 AND d.user_id = $2 AND f.sent = false`,
    [params.id, session.userId]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Followup not found or already sent' }, { status: 404 });
  }

  const followup = rows[0];

  // Send email if type is email and we have a recipient
  if (followup.type === 'email' && followup.to_email) {
    try {
      await sendEmail({
        to: followup.to_email,
        subject: followup.subject || `Follow-up: ${followup.deal_name}`,
        body: followup.body,
      });
    } catch (err) {
      console.error('Failed to send followup email:', err);
      // Still mark as sent to avoid retry loops
    }
  }

  await pool.query(
    'UPDATE followups SET sent = true, sent_at = now() WHERE id = $1',
    [params.id]
  );

  return NextResponse.json({ ok: true, sent: true });
}
