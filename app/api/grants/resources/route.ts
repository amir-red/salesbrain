/**
 * GET  /api/grants/resources?deal_id=<uuid>  → list resources for a grant
 * POST /api/grants/resources                 → create a resource on a grant
 *
 * Both delegate to the kernel (grant_resource_list / grant_resource_add).
 * RBAC + validation live there; this route is a thin envelope.
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { callGrantTool } from '@/lib/grants-api';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const deal_id = req.nextUrl.searchParams.get('deal_id');
  if (!deal_id) return Response.json({ error: 'deal_id required' }, { status: 400 });
  return callGrantTool(session, 'crm_grant_resource_list', { deal_id });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.deal_id) return Response.json({ error: 'deal_id required' }, { status: 400 });
  if (!body.resource_type) return Response.json({ error: 'resource_type required' }, { status: 400 });
  return callGrantTool(session, 'crm_grant_resource_add', body);
}
