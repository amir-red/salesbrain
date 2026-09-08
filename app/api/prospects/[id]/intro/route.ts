import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { draftIntroRequest } from '@/lib/intro-draft';
import { parseActAs, resolveActingUser } from '@/lib/act-as';

/**
 * Step 6 — the intro ask. {action:'draft'} writes a proposal text with the
 * model and saves nothing; {action:'propose'} files it through the kernel
 * (crm_propose_intro) as an approval the owner still has to send.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: {
    action?: 'draft' | 'propose'; as?: string; connector_person_id?: string; path_id?: string;
    connector?: { name: string; role: string; evidence: string; why?: string | null; channel?: string | null };
    message?: string; subject?: string; forwardable_blurb?: string; rationale?: string;
  } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.connector_person_id) return NextResponse.json({ error: 'connector_person_id required' }, { status: 400 });
  // The ask is written in, and filed under, the ACTING user's name: the lead's
  // owner by default when an admin is looking at someone else's lead.
  const acting = await resolveActingUser(session, params.id, parseActAs(body.as),
    body.action === 'propose' ? 'crm_propose_intro' : 'intro_draft', body.action === 'propose');
  if ('error' in acting) return NextResponse.json({ error: acting.error }, { status: acting.status });

  if (body.action === 'draft') {
    const own = session.role === 'admin' ? '' : 'AND (p.owner_user_id = $2 OR p.owner_user_id IS NULL)';
    const vals = session.role === 'admin' ? [params.id] : [params.id, session.userId];
    const { rows } = await pool.query(
      `SELECT c.full_name, c.title, a.name AS company, p.research_summary, p.qualification_reason,
              i.criteria->>'product' AS product, pe.full_name AS connector_name
         FROM prospects p
         LEFT JOIN contacts c ON c.id = p.contact_id
         LEFT JOIN accounts a ON a.id = p.account_id
         LEFT JOIN icp_profiles i ON i.id = p.icp_profile_id
         LEFT JOIN people pe ON pe.id = $${vals.length + 1}
        WHERE p.id = $1 ${own}`, [...vals, body.connector_person_id]);
    if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const r = rows[0];
    const out = await draftIntroRequest({
      owner_name: acting.actingName || 'me',
      connector: { name: body.connector?.name || r.connector_name || 'them', role: body.connector?.role || 'connection',
                   evidence: body.connector?.evidence || 'you know each other', why: body.connector?.why, channel: body.connector?.channel },
      lead: { name: r.full_name || 'the lead', title: r.title, company: r.company, research_summary: r.research_summary,
              qualification_reason: r.qualification_reason },
      product: r.product,
    });
    return NextResponse.json(out, { status: 'error' in out ? 502 : 200 });
  }

  if (body.action === 'propose') {
    if (!body.message?.trim()) return NextResponse.json({ error: 'message required' }, { status: 400 });
    try {
      const out = await kernelCall('crm_propose_intro', {
        connector_person_id: body.connector_person_id, lead_prospect_id: params.id,
        message: body.message, subject: body.subject, forwardable_blurb: body.forwardable_blurb,
        path_id: body.path_id, rationale: body.rationale,
      }, acting.actingUserId) as Record<string, unknown>;
      return NextResponse.json({ ...out, acted_as: { user_id: acting.actingUserId, name: acting.actingName, on_behalf: acting.onBehalf } });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  }
  return NextResponse.json({ error: "action must be 'draft' or 'propose'" }, { status: 400 });
}
