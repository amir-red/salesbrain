import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { parseActAs, resolveActingUser } from '@/lib/act-as';

/**
 * POST — research ONE person now through the same pass the nightly agent runs (LinkedIn profile inside the guard, the
 * web, one Google lookup) and re-score them. Runs as the lead's owner for an admin (their LinkedIn account, their
 * budgets; audited as act_as); anyone else only on their own leads.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const acting = await resolveActingUser(session, params.id, parseActAs(req.nextUrl.searchParams.get('as')), 'trust_research_one');
  if ('error' in acting) return NextResponse.json({ error: acting.error }, { status: acting.status });
  try {
    const out = await kernelCall('trust_research_one', { prospect_id: params.id }, acting.actingUserId);
    return NextResponse.json({ ...out, acting_as: acting.actingName }, { status: out.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
