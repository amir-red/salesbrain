/**
 * POST /api/deals/:id/sign
 *
 * Body: { signed_at?: string, new_lead_id?: string, reason?: string }
 *
 * Records that the grant agreement is signed (Stage 1 → Stage 2 handover).
 * Delegates to the kernel's `sign_grant_agreement` command, which:
 *   * sets `deals.contract_signed_at`
 *   * optionally reassigns `deals.lead_id` (the "Assigned Person")
 *   * writes a `deal_lead_history` audit row on handover
 *   * emits Telegram notifications to prev + new lead
 *
 * Permissions: same as any deal write — admin, creator (user_id), or
 * current lead. The kernel enforces this via `_visible_deal`.
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { callGrantTool } from '@/lib/grants-api';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: deal_id } = await params;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is fine — signed_at defaults to now */ }
  return callGrantTool(session, 'sign_grant_agreement', { deal_id, ...body });
}
