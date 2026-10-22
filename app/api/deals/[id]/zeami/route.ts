/**
 * GET /api/deals/:id/zeami — where this client's setup in the Zeami platform stands (handover part 3).
 *
 * Asks Zeami at the moment the deal page opens (no cache: Zeami says fetch on open). Readable by anyone who can
 * open the deal page (org-wide, §5.14). Always 200 with a `state` the panel renders:
 *   found            Zeami's body as given (stages, people, support group) + `sync`
 *   not_onboarded    Zeami answered 404: no company is set up for this deal yet
 *   unavailable      not configured here, Zeami's key not set (503), key refused (401), no answer — `message`
 * `sync` = what SalesBrain last told Zeami about this deal (zeami_deal_sync), or null.
 * `can_edit` = the viewer may add the support group (creator, assigned person, admin).
 */
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { zeamiFetch, zeamiProblem, type ZeamiOnboarding } from '@/lib/zeami';
import { zeamiSyncState } from '@/lib/zeami-sync';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid deal id' }, { status: 400 });

  const { rows } = await pool.query<{ user_id: string; lead_id: string | null; deal_type: string }>(
    'SELECT user_id, lead_id, deal_type FROM deals WHERE id = $1 AND deleted_at IS NULL', [id]);
  const deal = rows[0];
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
  if (deal.deal_type !== 'sales') return NextResponse.json({ error: 'Only sales deals are set up in Zeami' }, { status: 400 });

  const can_edit = session.role === 'admin' || deal.user_id === session.userId || deal.lead_id === session.userId;
  const r = await zeamiFetch<ZeamiOnboarding>('GET', `/sales-crm/onboarding?deal_id=${encodeURIComponent(id)}`);
  const sync = await zeamiSyncState(id);

  if (r.status === 200 && r.body) return NextResponse.json({ state: 'found', onboarding: r.body, sync, can_edit });
  if (r.status === 404) return NextResponse.json({ state: 'not_onboarded', sync, can_edit });
  return NextResponse.json({ state: 'unavailable', message: zeamiProblem(r), sync, can_edit });
}
