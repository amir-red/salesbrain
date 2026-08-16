/**
 * GET /api/credits/awarded?limit=100 → { count, credits: [...] }
 *
 * Thin proxy to the kernel's list_active_credits. Powers the /credits
 * Awarded tab. "Awarded" here = ai_credit deals at gate >= 4 (Awarded or
 * Active) with per-deal aggregates.
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { callGrantTool } from '@/lib/grants-api';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const limit = Number(req.nextUrl.searchParams.get('limit') || '100');
  return callGrantTool(session, 'crm_list_active_credits', { limit });
}
