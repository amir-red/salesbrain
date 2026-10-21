import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * GET   /api/firms/[id]   one firm on a list: research with sources, verdict + reasons, team, people (crm_firm_get)
 * PATCH /api/firms/[id]   { status?, eligibility?, reason?, contact_email?, contact_route?, notes?, priority?, rank? }
 * The kernel checks the list is the viewer's (or the viewer is an admin).
 */
const EDITABLE = ['status', 'eligibility', 'reason', 'contact_email', 'contact_route', 'notes', 'priority', 'rank'] as const;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await kernelCall('crm_firm_get', { firm_id: params.id }, session.userId));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const args: Record<string, unknown> = { firm_id: params.id };
  for (const k of EDITABLE) if (body[k] !== undefined) args[k] = body[k];
  try {
    return NextResponse.json(await kernelCall('crm_firm_update', args, session.userId));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
