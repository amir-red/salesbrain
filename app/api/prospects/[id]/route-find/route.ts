import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { parseActAs, resolveActingUser } from '@/lib/act-as';

/**
 * Step 5 of the lead's journey — how do I reach this person.
 * {mode:'find'} is read-only (crm_path_find); {mode:'expand'} spends LinkedIn
 * budget (crm_route_expand). Runs as the lead's OWNER for an admin unless
 * {as:'me'}; the owner's graph and LinkedIn are what an intro comes through.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { mode?: 'find' | 'expand'; as?: string; max_hops?: number; k?: number } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const mode = body.mode === 'expand' ? 'expand' : 'find';
  const tool = mode === 'expand' ? 'crm_route_expand' : 'crm_path_find';
  const acting = await resolveActingUser(session, params.id, parseActAs(body.as), tool);
  if ('error' in acting) return NextResponse.json({ error: acting.error }, { status: acting.status });
  try {
    const args = mode === 'expand'
      ? { prospect_id: params.id }
      : { prospect_id: params.id, ...(body.max_hops ? { max_hops: body.max_hops } : {}), ...(body.k ? { k: body.k } : {}) };
    const out = (await kernelCall(tool, args, acting.actingUserId)) as Record<string, unknown>;
    return NextResponse.json({ ...out, acted_as: { user_id: acting.actingUserId, name: acting.actingName, on_behalf: acting.onBehalf } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
