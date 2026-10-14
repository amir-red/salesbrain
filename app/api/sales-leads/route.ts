/**
 * GET /api/sales-leads?view=working|due|must|new|contacted|replied|converted|archived|all
 *                     &sort=priority|contact|newest &q=<name/company> &mine=1[&role=responsible|front]
 *   → { leads, counts, users }
 *
 * The team's lead dashboard (org-wide: any signed-in user sees every lead).
 *   working   open leads (not converted / archived), ranked — the daily list
 *   due       ping-by date reached, or quiet for 14+ days with no date set
 *   must      the ★ must-talk people
 *   contacted everyone we messaged, replied included (replied ⊂ contacted)
 * `status=` is still accepted as an alias of `view=` (the older page and the
 * service MCP use it).
 *
 * ONE client, sequential queries (Supabase session pooler — no fan-out).
 */
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { QUIET_WARN_DAYS, type LeadCounts, type LeadSort, type LeadView } from '@/lib/sales-leads';

const VIEWS = new Set<LeadView>(['working', 'due', 'must', 'new', 'contacted', 'replied', 'converted', 'archived', 'all']);
const SORTS: Record<LeadSort, string> = {
  priority: 'l.priority NULLS LAST, l.must_talk DESC, l.next_contact_at NULLS LAST, l.last_contact_at DESC NULLS LAST, l.created_at DESC',
  contact: 'COALESCE(l.last_contact_at, l.created_at) ASC, l.priority NULLS LAST',
  newest: 'l.created_at DESC',
};

const OPEN = "l.status NOT IN ('converted', 'archived')";
// Mirrors the kernel's ONE due predicate (commands/sales_leads.py::due_sql — change both): ping-by date reached, or
// quiet for 14+ days but only for leads that are starred, high priority, or were contacted at least once.
const DUE = `${OPEN} AND (l.next_contact_at <= current_date OR (l.next_contact_at IS NULL AND (l.must_talk OR l.priority <= 2 OR l.last_contact_at IS NOT NULL) AND COALESCE(l.last_contact_at, l.created_at) < now() - interval '${QUIET_WARN_DAYS} days'))`;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const view = (url.searchParams.get('view') || url.searchParams.get('status') || 'working') as LeadView;
  if (!VIEWS.has(view)) return NextResponse.json({ error: `Invalid view: ${view}` }, { status: 400 });
  const sort = (url.searchParams.get('sort') || 'priority') as LeadSort;
  if (!SORTS[sort]) return NextResponse.json({ error: `Invalid sort: ${sort}` }, { status: 400 });
  const q = (url.searchParams.get('q') || '').trim();
  const mine = url.searchParams.get('mine') === '1';
  // role=responsible → leads I drive (back office); role=front → leads I take the calls for; else either seat.
  const role = url.searchParams.get('role') === 'responsible' ? 'responsible'
    : url.searchParams.get('role') === 'front' ? 'front' : 'any';

  const where: string[] = [];
  const vals: unknown[] = [];
  if (view === 'working') where.push(OPEN);
  else if (view === 'due') where.push(DUE);
  else if (view === 'must') where.push(`${OPEN} AND l.must_talk`);
  else if (view === 'contacted') where.push("l.status IN ('contacted', 'replied')");
  else if (view !== 'all') { vals.push(view); where.push(`l.status = $${vals.length}`); }
  if (mine) {
    vals.push(session.userId);
    where.push(role === 'responsible' ? `l.responsible_user_id = $${vals.length}`
      : role === 'front' ? `l.front_user_id = $${vals.length}`
      : `(l.responsible_user_id = $${vals.length} OR l.front_user_id = $${vals.length})`);
  }
  if (q) { vals.push(`%${q}%`); where.push(`(l.full_name ILIKE $${vals.length} OR l.company ILIKE $${vals.length} OR l.title ILIKE $${vals.length} OR l.met_at ILIKE $${vals.length})`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const client = await pool.connect();
  try {
    const { rows: leads } = await client.query(
      `SELECT l.id, l.full_name, l.title, l.company, l.email, l.website, l.linkedin_url, l.description, l.notes, l.dossier,
              l.source, l.status, l.priority, l.must_talk, l.met_at,
              l.responsible_user_id, r.name AS responsible_name, l.front_user_id, f.name AS front_name,
              l.last_contact_at, to_char(l.next_contact_at, 'YYYY-MM-DD') AS next_contact_at,
              EXTRACT(day FROM now() - COALESCE(l.last_contact_at, l.created_at))::int AS days_since_contact,
              l.created_at, l.converted_at, l.converted_deal_id, d.name AS converted_deal_name, d.gate AS converted_deal_gate,
              l.raw_payload->>'prospect_id' AS prospect_id, ip.name AS icp_name,
              COALESCE((SELECT count(*)::int FROM outreach_approvals oa
                         WHERE oa.prospect_id::text = l.raw_payload->>'prospect_id' AND oa.status = 'pending'
                           AND (oa.expires_at IS NULL OR oa.expires_at > now())), 0) AS cards_pending,
              l.booking_status, l.booked_at, l.meet_link,
              l.preferred_demo_date, l.preferred_demo_time, l.preferred_demo_timezone,
              (SELECT jsonb_build_object('kind', e.kind, 'text', left(e.text, 240), 'occurred_at', e.occurred_at)
                 FROM sales_lead_events e WHERE e.lead_id = l.id AND e.kind IN ('met', 'sent', 'reply', 'call', 'meeting', 'note')
                ORDER BY e.occurred_at DESC, e.created_at DESC LIMIT 1) AS last_event
         FROM sales_leads l
         LEFT JOIN deals d ON d.id = l.converted_deal_id
         LEFT JOIN users r ON r.id = l.responsible_user_id
         LEFT JOIN users f ON f.id = l.front_user_id
         LEFT JOIN prospects p ON p.id::text = l.raw_payload->>'prospect_id'
         LEFT JOIN icp_profiles ip ON ip.id = p.icp_profile_id
         ${clause}
         ORDER BY ${SORTS[sort]}
         LIMIT 300`,
      vals,
    );

    const { rows: c } = await client.query(
      `SELECT count(*) FILTER (WHERE ${OPEN})::int AS working,
              count(*) FILTER (WHERE ${DUE})::int AS due,
              count(*) FILTER (WHERE ${OPEN} AND l.must_talk)::int AS must,
              count(*) FILTER (WHERE l.status = 'new')::int AS new,
              count(*) FILTER (WHERE l.status IN ('contacted', 'replied'))::int AS contacted,
              count(*) FILTER (WHERE l.status = 'replied')::int AS replied,
              count(*) FILTER (WHERE l.status = 'converted')::int AS converted,
              count(*) FILTER (WHERE l.status = 'archived')::int AS archived,
              count(*)::int AS all,
              count(*) FILTER (WHERE l.booking_status = 'scheduled')::int AS booked
         FROM sales_leads l`,
    );
    const counts = c[0] as LeadCounts;

    // Teammates for the responsible / front pickers: real logins, no service stubs.
    const { rows: users } = await client.query(
      `SELECT id, name, email FROM users
        WHERE email NOT LIKE '%.service.salesbrain' AND email NOT LIKE '%@salesbrain.internal'
          AND email NOT LIKE '%@example.com' AND name NOT ILIKE 'HAW %'
        ORDER BY name`,
    );

    return NextResponse.json({ viewer_id: session.userId, leads, counts, users, view, sort });
  } finally {
    client.release();
  }
}
