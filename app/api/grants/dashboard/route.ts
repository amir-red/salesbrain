/**
 * GET /api/grants/dashboard  → { resources_at_risk, reports_due }
 *
 * Combined feed for /grants: RBAC-scoped resources needing attention plus
 * reports due within the next `days` (default 30). Two kernel calls
 * fired in parallel.
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const days = Number(req.nextUrl.searchParams.get('days') || '30');
  try {
    const [risk, due] = await Promise.all([
      kernelCall('crm_grants_at_risk', {}, session.userId),
      kernelCall('crm_grants_reports_due', { days }, session.userId),
    ]);
    return Response.json({ resources_at_risk: risk, reports_due: due });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 400 });
  }
}
