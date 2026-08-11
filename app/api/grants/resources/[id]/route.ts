/**
 * PATCH /api/grants/resources/:id  → update fields on a resource row
 * DELETE /api/grants/resources/:id → remove a resource row
 *
 * RBAC in the kernel via _ensure_grant → _visible_deal.
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { callGrantTool } from '@/lib/grants-api';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: resource_id } = await params;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  return callGrantTool(session, 'crm_grant_resource_update', { resource_id, ...body });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: resource_id } = await params;
  return callGrantTool(session, 'crm_grant_resource_delete', { resource_id });
}
