/**
 * POST /api/deals/:id/mark-cancelled
 *
 * Body: { reason: string }
 *
 * Marks a deal (grant OR sales) cancelled — distinct from 'lost'.
 * Cancelled = stopped after having won or committed. Lost = never won.
 * Reason is required and stored in `deals.cancelled_reason`.
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { callGrantTool } from '@/lib/grants-api';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: deal_id } = await params;
  let body: { reason?: string } = {};
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.reason?.trim()) return Response.json({ error: 'reason is required' }, { status: 400 });
  return callGrantTool(session, 'mark_deal_cancelled', { deal_id, reason: body.reason.trim() });
}
