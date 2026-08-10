/**
 * GET /api/grants/awarded?limit=50 → { count, grants: [...] }
 *
 * Thin proxy to the kernel's list_won_grants. Powers the /grants
 * "Awarded" tab.
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { callGrantTool } from '@/lib/grants-api';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const limit = Number(req.nextUrl.searchParams.get('limit') || '50');
  return callGrantTool(session, 'list_won_grants', { limit });
}
