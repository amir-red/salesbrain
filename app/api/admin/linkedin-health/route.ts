/**
 * GET /api/admin/linkedin-health — the LinkedIn safe-rate monitor.
 *
 * Per connected LinkedIn account: today's Unipile call volume by action vs the
 * account's safe daily cap, tier, proxy country, error/block counts, pause
 * state, and a 7-day trend. Reads across owners, so admin-only. Thin proxy to
 * the kernel's crm_linkedin_health (single source of truth for the aggregation).
 *
 * POST { unipile_account_id } — resume a paused/blocked account
 * (crm_agent_resume_account), same as the /agents Resume button.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  try {
    const out = await kernelCall('crm_linkedin_health', {}, session.userId);
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  let body: { unipile_account_id?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.unipile_account_id) return NextResponse.json({ error: 'unipile_account_id required' }, { status: 400 });
  try {
    const out = await kernelCall('crm_agent_resume_account', { unipile_account_id: body.unipile_account_id }, session.userId);
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
