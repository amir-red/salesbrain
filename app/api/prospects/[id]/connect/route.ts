import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { parseActAs, resolveActingUser } from '@/lib/act-as';

/**
 * File a LinkedIn connection request to this lead for the owner's approval.
 * Sends nothing — the owner decides on the card (Telegram, /agents or the ICP
 * page). Runs as the lead's owner for an admin unless {as:'me'}: the request
 * goes out from the OWNER's LinkedIn account.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { note?: string; as?: string } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
  const acting = await resolveActingUser(session, params.id, parseActAs(body.as), 'crm_linkedin_connect_propose');
  if ('error' in acting) return NextResponse.json({ error: acting.error }, { status: acting.status });
  try {
    const out = (await kernelCall('crm_linkedin_connect_propose',
      { prospect_id: params.id, ...(note ? { note } : {}) }, acting.actingUserId)) as Record<string, unknown>;
    return NextResponse.json(
      { ...out, acted_as: { user_id: acting.actingUserId, name: acting.actingName, on_behalf: acting.onBehalf } },
      { status: out.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
