import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { guardEditable } from '@/lib/icp-server';

/**
 * POST /api/icp/:id/owner  { owner_user_id }  — give the list to another teammate (its owner or an admin may).
 * The leads the old owner holds on the list move too (kernel commands/icp_owner.py; Amir 2026-10-26: all of them,
 * also those already in a conversation). Answers the kernel's summary: leads_moved, in_conversation,
 * kept_duplicates, note.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const guard = await guardEditable(params.id, session);
  if (guard.denied) return guard.denied;
  let body: { owner_user_id?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.owner_user_id) return NextResponse.json({ error: 'owner_user_id is required' }, { status: 400 });
  try {
    const out = await kernelCall('crm_icp_set_owner', { icp_id: params.id, new_owner: body.owner_user_id }, session.userId) as Record<string, unknown>;
    if (out.error) return NextResponse.json(out, { status: out.refused ? 403 : 400 });
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not change the owner' }, { status: 502 });
  }
}
