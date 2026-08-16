/**
 * POST /api/credits/backfill
 *
 * Body: { name, company, provider, credit_program_name, applicant_entity,
 *         award_amount, currency?, credits_activated_at?, expires_at?,
 *         units_label?, notes? }
 *
 * One-shot backfill for an already-received AI/cloud credit. Creates an
 * ai_credit deal at gate=5 (Active) + its matching grant_resources row in
 * a single transaction (kernel handles the atomicity). Powers the "Add
 * existing credit" flow on /credits.
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { callGrantTool } from '@/lib/grants-api';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  for (const key of ['name', 'company', 'provider', 'credit_program_name',
                     'applicant_entity', 'award_amount']) {
    if (body[key] === undefined || body[key] === null || body[key] === '') {
      return Response.json({ error: `${key} required` }, { status: 400 });
    }
  }
  return callGrantTool(session, 'crm_add_ai_credit', body);
}
