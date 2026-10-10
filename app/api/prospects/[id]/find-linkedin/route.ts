import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { parseActAs, resolveActingUser } from '@/lib/act-as';
import { describeLookup } from '@/lib/connect';

/**
 * Find this lead's LinkedIn profile by name + company, or attach the one a
 * person picked.
 *
 *   POST {}                                  → one people search on the owner's
 *                                              account; the slug is written only
 *                                              on exactly one strong match
 *                                              (Enricher kind 'linkedin').
 *   POST {public_identifier, member_id?}      → the explicit pick among the
 *                                              candidates a search returned.
 *
 * Runs as the lead's owner for an admin unless {as:'me'}: the search spends
 * the OWNER's LinkedIn account. Contacts no one.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { as?: string; public_identifier?: string; member_id?: string } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const pick = typeof body.public_identifier === 'string' ? body.public_identifier.trim() : '';
  const command = pick ? 'crm_linkedin_link_prospect' : 'crm_enrich_prospect';
  const acting = await resolveActingUser(session, params.id, parseActAs(body.as), command);
  if ('error' in acting) return NextResponse.json({ error: acting.error }, { status: acting.status });
  const actedAs = { user_id: acting.actingUserId, name: acting.actingName, on_behalf: acting.onBehalf };
  try {
    if (pick) {
      const out = (await kernelCall('crm_linkedin_link_prospect',
        { prospect_id: params.id, public_identifier: pick, ...(body.member_id ? { member_id: String(body.member_id) } : {}) },
        acting.actingUserId)) as Record<string, unknown>;
      const note = out.written ? `Profile attached: ${out.linkedin_public_id}.` : String(out.error || out.note || 'Not attached.');
      return NextResponse.json({ ...out, note, acted_as: actedAs }, { status: out.error ? 400 : 200 });
    }
    const out = (await kernelCall('crm_enrich_prospect', { prospect_id: params.id, kinds: ['linkedin'] }, acting.actingUserId)) as Record<string, unknown>;
    if (out.error) return NextResponse.json({ ...out, acted_as: actedAs }, { status: 400 });
    const lookup = (typeof out.linkedin === 'object' && out.linkedin ? out.linkedin : null) as Parameters<typeof describeLookup>[0];
    const note = typeof out.linkedin === 'string' ? out.linkedin : describeLookup(lookup);
    // web-first ladder: say which rungs ran so "no match" is never read as "not searched"
    const q = (lookup as { queries?: string[] } | null)?.queries;
    return NextResponse.json({ lookup, note: q?.length ? `${note} (${q.length} search${q.length > 1 ? 'es' : ''}: web + LinkedIn)` : note, run_id: out.run_id, acted_as: actedAs });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
