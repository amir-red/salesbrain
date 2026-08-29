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
  const values: unknown[] = [];
  const where: string[] = [];
  if (session.role !== 'admin') { values.push(session.userId); where.push(`oa.owner_user_id = $${values.length}`); }
  if (!all) where.push(`oa.status = 'pending'`);
  const { rows } = await pool.query(
    `SELECT oa.id, oa.status, oa.channel, oa.subject, oa.message, oa.rationale, oa.created_at, oa.decided_at,
            oa.sent_at, oa.expires_at, oa.prospect_id, oa.person_id, oa.owner_user_id,
            pe.full_name AS person_name, c.title, a.name AS company, p.icp_score, i.name AS icp_name,
            u.name AS owner_name
     FROM outreach_approvals oa
     LEFT JOIN people pe ON pe.id = oa.person_id
     LEFT JOIN prospects p ON p.id = oa.prospect_id
     LEFT JOIN contacts c ON c.id = p.contact_id
     LEFT JOIN accounts a ON a.id = p.account_id
     LEFT JOIN icp_profiles i ON i.id = p.icp_profile_id
     LEFT JOIN users u ON u.id = oa.owner_user_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY oa.created_at DESC LIMIT 100`, values);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { approval_id?: string; decision?: 'approve' | 'reject' } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.approval_id || !['approve', 'reject'].includes(body.decision || '')) {
    return NextResponse.json({ error: 'approval_id and decision (approve|reject) required' }, { status: 400 });
  }
  try {
    const out = await kernelCall('crm_outreach_decide', { approval_id: body.approval_id, decision: body.decision }, session.userId);
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
