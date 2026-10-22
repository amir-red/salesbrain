/**
 * PUT /api/deals/:id/zeami/support-group  { name, link } — add the client's support group in Zeami (handover
 * part 4). Zeami accepts it only while none is saved (409 after that: it is changed in the Zeami console) and
 * emails the project manager. Same permission as any deal write: creator, assigned person, admin.
 * Answers like GET /api/deals/:id/zeami (state 'found' with Zeami's body), or { error } with Zeami's reason.
 */
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { zeamiFetch, zeamiProblem, type ZeamiOnboarding } from '@/lib/zeami';
import { zeamiSyncState } from '@/lib/zeami-sync';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const { rows } = await pool.query<{ user_id: string; lead_id: string | null; deal_type: string }>(
    'SELECT user_id, lead_id, deal_type FROM deals WHERE id = $1 AND deleted_at IS NULL', [id]);
  const deal = rows[0];
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
  if (deal.deal_type !== 'sales') return NextResponse.json({ error: 'Only sales deals are set up in Zeami' }, { status: 400 });
  if (!(session.role === 'admin' || deal.user_id === session.userId || deal.lead_id === session.userId)) {
    return NextResponse.json({ error: 'Only the deal owner, its assigned person or an admin can add the support group' }, { status: 403 });
  }

  let body: { name?: unknown; link?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const name = String(body.name ?? '').trim().slice(0, 200);
  const link = String(body.link ?? '').trim();
  if (!name) return NextResponse.json({ error: 'Give the group a name' }, { status: 422 });
  if (!/^https:\/\/\S+$/i.test(link)) return NextResponse.json({ error: 'The link must start with https://' }, { status: 422 });

  const r = await zeamiFetch<ZeamiOnboarding>('PUT', '/sales-crm/onboarding/support-group', { deal_id: id, name, link });
  if (r.status === 200 && r.body) {
    return NextResponse.json({ state: 'found', onboarding: r.body, sync: await zeamiSyncState(id), can_edit: true });
  }
  if (r.status === 409) {
    return NextResponse.json({ error: 'A support group is already saved for this client. Change it in the Zeami console.' }, { status: 409 });
  }
  if (r.status === 404) return NextResponse.json({ error: 'This client is not set up in Zeami yet.' }, { status: 404 });
  if (r.status === 422) return NextResponse.json({ error: r.error || 'Zeami did not accept that group.' }, { status: 422 });
  return NextResponse.json({ error: zeamiProblem(r) }, { status: 502 });
}
