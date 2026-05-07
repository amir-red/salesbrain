import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { canMutate, composeItAdminEmail, type OnboardingRow } from '@/lib/onboarding';

/**
 * POST /api/onboardings/[id]/send-email
 * Stage 3 IT-Admin email. Requires server_setup_done + app_setup_done +
 * download_url + app_credentials + it_admin_email. Clears app_credentials
 * after a successful send and stamps email_sent_at.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows } = await pool.query<OnboardingRow>(
    `SELECT * FROM client_onboardings WHERE id = $1`,
    [params.id]
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canMutate(session, row)) {
    return NextResponse.json({ error: 'You are not the assigned PM' }, { status: 403 });
  }

  // Pre-flight checks — each maps to a friendly error so the PM can act on it.
  if (!row.server_setup_done) return NextResponse.json({ error: 'Mark Server Setup as done before sending' }, { status: 400 });
  if (!row.app_setup_done)    return NextResponse.json({ error: 'Mark App Setup as done before sending' }, { status: 400 });
  if (!row.download_url?.trim()) return NextResponse.json({ error: 'Download URL is required' }, { status: 400 });
  if (!row.app_credentials?.trim()) return NextResponse.json({ error: 'Admin credentials are required' }, { status: 400 });
  if (!row.it_admin_email?.trim()) return NextResponse.json({ error: 'IT admin email is required (Stage 2)' }, { status: 400 });

  const { subject, body } = composeItAdminEmail(row);

  try {
    await sendEmail({ to: row.it_admin_email, subject, body });
  } catch (err) {
    console.error('[onboarding send-email] Failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Email send failed' },
      { status: 502 }
    );
  }

  // On success: stamp email_sent_at, clear credentials from DB, and bump to stage 4.
  await pool.query(
    `UPDATE client_onboardings
     SET email_sent_at = COALESCE(email_sent_at, now()),
         app_credentials = NULL,
         stage = CASE WHEN stage = 3 THEN 4 ELSE stage END,
         stage3_completed_at = CASE WHEN stage = 3 OR stage3_completed_at IS NULL THEN now() ELSE stage3_completed_at END
     WHERE id = $1`,
    [params.id]
  );

  return NextResponse.json({ ok: true, sent_to: row.it_admin_email });
}
