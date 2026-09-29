import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * GET /api/admin/costs?days= — what the system cost to run over a window.
 * Admin only: it reads across owners.
 *
 * A passthrough to the kernel's `crm_cost_report`. Prices live in
 * policy_rules['costs.rates'] and are applied in Python, so the app holds no
 * second copy of the arithmetic. Loaded on demand, not polled — a kernel call
 * is a subprocess, and spend does not change by the second.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const raw = Number(req.nextUrl.searchParams.get('days') || 30);
  const days = Number.isFinite(raw) ? Math.max(1, Math.min(Math.trunc(raw), 365)) : 30;

  try {
    return NextResponse.json(await kernelCall('crm_cost_report', { days }, session.userId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Cost report failed: ${msg}` }, { status: 502 });
  }
}
