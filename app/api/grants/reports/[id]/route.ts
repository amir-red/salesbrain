/**
 * PATCH /api/grants/reports/:id  → update fields on a report row
 * DELETE /api/grants/reports/:id → remove a report row
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { callGrantTool } from '@/lib/grants-api';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: report_id } = await params;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  return callGrantTool(session, 'grant_report_update', { report_id, ...body });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: report_id } = await params;
  return callGrantTool(session, 'grant_report_delete', { report_id });
}
