/**
 * GET  /api/grants/reports?deal_id=<uuid>  → list reports for a grant
 * POST /api/grants/reports                 → schedule a new report
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { callGrantTool } from '@/lib/grants-api';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const deal_id = req.nextUrl.searchParams.get('deal_id');
  if (!deal_id) return Response.json({ error: 'deal_id required' }, { status: 400 });
  return callGrantTool(session, 'grant_report_list', { deal_id });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  for (const key of ['deal_id', 'report_type', 'title', 'due_at']) {
    if (!body[key]) return Response.json({ error: `${key} required` }, { status: 400 });
  }
  return callGrantTool(session, 'grant_report_add', body);
}
