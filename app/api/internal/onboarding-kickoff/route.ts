import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { sendOnboardingKickoffEmail } from '@/lib/onboarding-server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/onboarding-kickoff  { onboarding_id }
 *
 * Server-to-server bridge for the Hermes runtime: when the kernel creates the
 * G9 onboarding row, the ring calls this to fire the welcome/kickoff email —
 * the form-token flow stays app-owned instead of being duplicated in Python.
 * Auth: x-internal-key must match HERMES_API_KEY (the same secret the app
 * already shares with the gateway). Loopback-only in practice; never exposed
 * to browsers.
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get('x-internal-key');
  if (!process.env.HERMES_API_KEY || key !== process.env.HERMES_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { onboarding_id } = await req.json().catch(() => ({}));
  if (!onboarding_id || typeof onboarding_id !== 'string') {
    return NextResponse.json({ error: 'onboarding_id required' }, { status: 400 });
  }

  const { rows } = await pool.query(
    `SELECT o.id, o.company_name, o.pm_user_id, d.contact_email,
            u.name AS pm_name, u.email AS pm_email
     FROM client_onboardings o
     JOIN deals d ON d.id = o.deal_id
     LEFT JOIN users u ON u.id = o.pm_user_id
     WHERE o.id = $1`,
    [onboarding_id]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Onboarding not found' }, { status: 404 });
  }
  const o = rows[0];

  const result = await sendOnboardingKickoffEmail({
    onboardingId: o.id,
    companyName: o.company_name,
    recipient: o.contact_email ?? null,
    pmName: o.pm_name ?? null,
    pmEmail: o.pm_email ?? null,
  });

  return NextResponse.json(result);
}
