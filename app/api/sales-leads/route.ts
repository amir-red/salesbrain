/**
 * Internal (authenticated) API for browsing demo-form submissions.
 *
 *   GET /api/sales-leads?status=new|contacted|replied|converted|archived|all
 *     → { leads, counts: { new, contacted, replied, converted, archived, all, booked } }
 *   `contacted` = everyone we messaged, replied included (replied ⊂ contacted), both in the
 *   list filter and in `counts`.
 *
 * Org-wide visibility (any signed-in user sees the inbox). Default filter is
 * `new` so the page opens to "what needs triage."
 */
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get('status') || 'new';

  const validStatuses = new Set(['new', 'contacted', 'replied', 'converted', 'archived', 'all']);
  if (!validStatuses.has(status)) {
    return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
  }

  const filterClause = status === 'all' ? ''
    : status === 'contacted' ? "WHERE l.status IN ('contacted', 'replied')"
    : 'WHERE l.status = $1';
  const params = status === 'all' || status === 'contacted' ? [] : [status];

  const { rows } = await pool.query(
    `SELECT l.id, l.full_name, l.company, l.email, l.description, l.source,
            l.website,
            l.status, l.created_at, l.converted_at, l.converted_deal_id,
            l.preferred_demo_date, l.preferred_demo_time, l.preferred_demo_timezone,
            l.calendly_event_uuid, l.meet_link, l.reschedule_url, l.cancel_url,
            l.booked_at, l.booking_status,
            d.name AS converted_deal_name, d.gate AS converted_deal_gate
     FROM sales_leads l
     LEFT JOIN deals d ON d.id = l.converted_deal_id
     ${filterClause}
     ORDER BY l.created_at DESC
     LIMIT 200`,
    params,
  );

  // Tab counts + summary cards: one grouped query, run after the list (no fan-out).
  const { rows: countRows } = await pool.query(
    `SELECT status, count(*)::int AS n,
            count(*) FILTER (WHERE booking_status = 'scheduled')::int AS booked
     FROM sales_leads GROUP BY status`,
  );
  const counts: Record<string, number> = { new: 0, contacted: 0, replied: 0, converted: 0, archived: 0, all: 0, booked: 0 };
  for (const r of countRows) {
    counts[r.status] = r.n;
    counts.all += r.n;
    counts.booked += r.booked;
  }
  counts.contacted += counts.replied;   // replied people were contacted first

  return NextResponse.json({ leads: rows, counts });
}
