import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { prefillFromDeal } from '@/lib/onboarding';
import { sendOnboardingKickoffEmail } from '@/lib/onboarding-server';

/**
 * GET /api/onboardings
 * Returns every onboarding (org-wide) for the kanban.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { rows } = await pool.query(
      `SELECT o.*,
              d.name as deal_name, d.company as deal_company, d.contact_email as deal_contact_email,
              u.name as pm_name, u.email as pm_email,
              a.name as assistant_name, a.email as assistant_email
       FROM client_onboardings o
       LEFT JOIN deals d ON d.id = o.deal_id
       LEFT JOIN users u ON u.id = o.pm_user_id
       LEFT JOIN users a ON a.id = o.assistant_user_id
       ORDER BY o.updated_at DESC`
    );
    return NextResponse.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Query failed';
    // Translate "relation does not exist" into an actionable hint.
    const hint = /relation .+ does not exist/i.test(msg)
      ? ' — run db/migrations/003_client_onboardings.sql on your database'
      : '';
    console.error('[GET /api/onboardings]', err);
    return NextResponse.json({ error: msg + hint }, { status: 500 });
  }
}

const CreateSchema = z.object({
  deal_id: z.string().uuid(),
});

/**
 * POST /api/onboardings { deal_id }
 * Manually create an onboarding for an existing won (G9) sales deal.
 * Auto-creation on G9 happens in lib/tool-executors.ts.
 * Idempotent: returns the existing row if one already exists.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }
  const { deal_id } = parsed.data;

  // Verify the deal exists and is a sales deal at G9.
  const { rows: dealRows } = await pool.query(
    `SELECT id, company, notes, fields, lead_id, gate, deal_type, contact_email FROM deals WHERE id = $1`,
    [deal_id]
  );
  const deal = dealRows[0];
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
  if (deal.deal_type !== 'sales') {
    return NextResponse.json({ error: 'Onboarding is only for sales deals' }, { status: 400 });
  }
  // Allow manual creation from any won sales deal — admins may also start from earlier gates if needed,
  // but enforce G9 by default for regular users.
  if (deal.gate < 9 && session.role !== 'admin') {
    return NextResponse.json({ error: 'Deal must reach G9 (Project Handover) before onboarding can start' }, { status: 400 });
  }

  // Idempotent
  const { rows: existing } = await pool.query(
    `SELECT * FROM client_onboardings WHERE deal_id = $1 LIMIT 1`,
    [deal_id]
  );
  if (existing[0]) return NextResponse.json(existing[0]);

  const pf = prefillFromDeal({
    company: deal.company as string,
    contact_email: (deal.contact_email as string | null) ?? null,
    notes: (deal.notes as string | null) ?? null,
    fields: (deal.fields as Record<string, unknown> | null) ?? null,
  });

  const pmUserId = deal.lead_id ?? session.userId;
  const { rows } = await pool.query(
    `INSERT INTO client_onboardings
      (deal_id, pm_user_id, company_name, website, company_size, description, deployment_plan, primary_contact_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      deal_id,
      pmUserId,
      pf.company_name,
      pf.website,
      pf.company_size,
      pf.description,
      pf.deployment_plan,
      pf.primary_contact_email,
    ]
  );
  const inserted = rows[0];

  // Fire the welcome / kickoff email to the deal's contact_email. Best-effort:
  // returns the row even if the email fails so the PM can recover from the UI.
  let emailResult: Awaited<ReturnType<typeof sendOnboardingKickoffEmail>> | null = null;
  try {
    let pmName: string | null = null;
    let pmEmail: string | null = null;
    if (pmUserId) {
      const { rows: pmRows } = await pool.query('SELECT name, email FROM users WHERE id = $1', [pmUserId]);
      pmName = pmRows[0]?.name ?? null;
      pmEmail = pmRows[0]?.email ?? null;
    }
    emailResult = await sendOnboardingKickoffEmail({
      onboardingId: inserted.id,
      companyName: inserted.company_name,
      recipient: (deal.contact_email as string | null) ?? null,
      pmName,
      pmEmail,
    });
  } catch (err) {
    console.error('[POST /api/onboardings] kickoff email error:', err);
  }

  return NextResponse.json({ ...inserted, kickoff_email: emailResult }, { status: 201 });
}
