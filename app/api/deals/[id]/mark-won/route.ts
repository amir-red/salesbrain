/**
 * POST /api/deals/:id/mark-won
 *
 * Body: { won_at?: string }
 *
 * Closes a grant as won. HARD REQUIRES (enforced in the kernel):
 *   * contract_signed_at is set
 *   * every grant_resource is in a terminal status
 *   * every grant_report is 'accepted'
 *
 * If any check fails the kernel returns 409 with `blockers[]` listing
 * offending row ids so the UI can link back.
 *
 * Grant-only. Sales deals keep the legacy "gate == finalGate ≈ won" model.
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { callGrantTool } from '@/lib/grants-api';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: deal_id } = await params;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  return callGrantTool(session, 'crm_mark_grant_won', { deal_id, ...body });
}
