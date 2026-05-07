import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { canMutate, type OnboardingRow } from '@/lib/onboarding';
import { sendOnboardingKickoffEmail } from '@/lib/onboarding-server';

/**
 * POST /api/onboardings/[id]/form-link
 *
 * Resends the onboarding kickoff email (welcome + Stage-2 form CTA) for a
 * given onboarding row. The same email goes out on initial onboarding
 * creation; this endpoint is the manual "Resend client form" button on
 * Stage 2 of the detail page.
 *
 * Returns { url, email_sent } so the PM can also copy/share the link manually.
 * Optional body field `to` overrides the recipient (defaults to the deal's
 * contact_email).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let bodyJson: { to?: string } = {};
  try { bodyJson = await req.json(); } catch { /* body is optional */ }

  const { rows } = await pool.query<OnboardingRow & {
    deal_contact_email: string | null;
    pm_name: string | null;
    pm_email: string | null;
  }>(
    `SELECT o.*, d.contact_email as deal_contact_email,
            u.name as pm_name, u.email as pm_email
     FROM client_onboardings o
     LEFT JOIN deals d ON d.id = o.deal_id
     LEFT JOIN users u ON u.id = o.pm_user_id
     WHERE o.id = $1`,
    [params.id]
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canMutate(session, row)) {
    return NextResponse.json({ error: 'You are not the assigned PM' }, { status: 403 });
  }

  const recipient = (bodyJson.to?.trim()) || row.deal_contact_email;
  if (!recipient) {
    return NextResponse.json(
      { error: 'No recipient email — pass { to } or set the deal contact_email' },
      { status: 400 }
    );
  }

  const result = await sendOnboardingKickoffEmail({
    onboardingId: row.id,
    companyName: row.company_name,
    recipient,
    pmName: row.pm_name,
    pmEmail: row.pm_email,
  });

  // The token is always issued (even if the email send fails) so the PM can
  // share the URL manually. Surface that to the caller.
  return NextResponse.json({
    url: result.formUrl,
    email_sent: result.sent,
    recipient: result.recipient,
    error: result.error,
  });
}
