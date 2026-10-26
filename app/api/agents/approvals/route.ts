import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * Outreach drafts awaiting a decision. GET is a direct read (owner-scoped;
 * admins see all). POST {approval_id, decision} goes through the kernel/ring
 * (crm_outreach_decide) so approving here sends through the same policy gate
 * as the Telegram 👍 — and is refused for anyone but the draft's owner.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const all = req.nextUrl.searchParams.get('all') === '1';
  // ?rate=1 — Brand & Voice (079): the viewer's OWN drafts decided in the last 14 days that nobody rated yet, so a
  // draft approved on Telegram can still get its 1–10 here. Always owner-scoped (rating someone else's voice is not
  // offered, even to an admin).
  const rate = req.nextUrl.searchParams.get('rate') === '1';
  const values: unknown[] = [];
  const where: string[] = [];
  if (session.role !== 'admin' || rate) { values.push(session.userId); where.push(`oa.owner_user_id = $${values.length}`); }
  if (rate) where.push(`oa.status IN ('sent', 'rejected') AND oa.rated_at IS NULL AND oa.kind <> 'proposal'
                         AND COALESCE(oa.decided_at, oa.created_at) > now() - interval '14 days'`);
  // Pending drafts, plus first messages the one-person-per-company rule held at send time (nothing was sent;
  // the owner can still choose "Send anyway").
  if (!all && !rate) where.push(`(oa.status = 'pending' OR (oa.status = 'failed' AND oa.company_conflict IS NOT NULL
                     AND oa.company_override_at IS NULL AND oa.consumed_at IS NULL AND oa.sent_at IS NULL))`);
  // A campaign draft is one line on a daily card (/campaigns/cards/[id]); deciding it here alone would bypass the
  // card and the step's trust count (084), so the pending list leaves them out.
  if (!all && !rate) where.push('oa.campaign_card_id IS NULL');
  const { rows } = await pool.query(
    `SELECT oa.id, oa.status, oa.kind, oa.commercial, oa.channel, oa.subject, oa.message, oa.rationale,
            oa.created_at, oa.decided_at, oa.sent_at, oa.expires_at, oa.prospect_id, oa.person_id, oa.owner_user_id,
            pe.full_name AS person_name, c.title, a.name AS company, p.icp_score, i.name AS icp_name,
            u.name AS owner_name, oa.company_conflict, oa.company_override_at,
            oa.check_flags, oa.edited_at, oa.rating, oa.draft_original IS NOT NULL AS model_drafted
     FROM outreach_approvals oa
     LEFT JOIN people pe ON pe.id = oa.person_id
     LEFT JOIN prospects p ON p.id = oa.prospect_id
     LEFT JOIN contacts c ON c.id = p.contact_id
     LEFT JOIN accounts a ON a.id = p.account_id
     LEFT JOIN icp_profiles i ON i.id = COALESCE(oa.icp_profile_id, p.icp_profile_id)
     LEFT JOIN users u ON u.id = oa.owner_user_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${rate ? 'COALESCE(oa.decided_at, oa.created_at)' : 'oa.created_at'} DESC LIMIT ${rate ? 20 : 100}`, values);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { approval_id?: string; decision?: 'approve' | 'reject' | 'approve_anyway' } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.approval_id || !['approve', 'reject', 'approve_anyway'].includes(body.decision || '')) {
    return NextResponse.json({ error: 'approval_id and decision (approve|reject|approve_anyway) required' }, { status: 400 });
  }
  try {
    const out = await kernelCall('crm_outreach_decide', { approval_id: body.approval_id, decision: body.decision }, session.userId);
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
