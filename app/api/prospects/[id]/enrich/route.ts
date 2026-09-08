import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { parseActAs, resolveActingUser } from '@/lib/act-as';

/** Step 4 — enrich one lead now. Runs as the lead's owner for an admin unless {as:'me'}. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { kinds?: string[]; as?: string } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const allowed = new Set(['employer', 'research', 'warm', 'email']);
  const kinds = (body.kinds || []).filter((k) => allowed.has(k));
  const acting = await resolveActingUser(session, params.id, parseActAs(body.as), 'crm_enrich_prospect');
  if ('error' in acting) return NextResponse.json({ error: acting.error }, { status: acting.status });
  try {
    const out = (await kernelCall('crm_enrich_prospect', { prospect_id: params.id, ...(kinds.length ? { kinds } : {}) }, acting.actingUserId)) as Record<string, unknown>;
    return NextResponse.json({ ...out, acted_as: { user_id: acting.actingUserId, name: acting.actingName, on_behalf: acting.onBehalf } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
