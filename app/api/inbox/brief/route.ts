import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * GET ?prospect=<id> | ?person=<id> — the research column beside an Inbox conversation (2026-11-10): the kernel's
 * lead brief for the person on the other side, with "Check before you write" for the VIEWER. A thread that names only
 * a person is read through their best lead row; someone not in the CRM answers { not_a_lead: true }. Read-only,
 * readable by every teammate like the person page.
 */
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const prospect = req.nextUrl.searchParams.get('prospect') || '';
  const person = req.nextUrl.searchParams.get('person') || '';
  if (!UUID.test(prospect) && !UUID.test(person)) return NextResponse.json({ error: 'prospect or person is required' }, { status: 400 });
  try {
    const out = await kernelCall('lead_brief', UUID.test(prospect) ? { prospect_id: prospect } : { person_id: person }, session.userId);
    if (out.not_a_lead) return NextResponse.json(out, { status: 200 });
    return NextResponse.json(out, { status: out.error ? 404 : 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // kernelCall throws on any { error }; a kernel before 0.91.2 answered "not a lead" that way (2026-11-13).
    if (msg.startsWith('Not in the CRM yet')) return NextResponse.json({ not_a_lead: true }, { status: 200 });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
