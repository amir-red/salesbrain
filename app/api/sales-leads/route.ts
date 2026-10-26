/**
 * GET /api/sales-leads?view=working|due|must|needs_you|new|contacted|replied|converted|archived|all
 *                     &sort=priority|contact|newest &q=<name/company> &mine=1[&role=responsible|front]
 *                     &stage=<lifecycle stage>
 *   → { leads, counts, funnel, users }
 *
 * The team's lead dashboard (org-wide: any signed-in user sees every lead).
 *   working   open leads (not converted / archived), ranked — the daily list
 *   due       ping-by date reached, or quiet for 14+ days with no date set
 *   must      the ★ must-talk people
 *   needs_you leads where a PERSON must act (pick a profile, approve a card, answer a reply, …) — the Lead
 *             Conductor's verdict. With mine=1 it also includes leads whose prospect the viewer owns (the sender
 *             approves the cards even when someone else is the back office).
 *   contacted everyone we messaged, replied included (replied ⊂ contacted)
 * `status=` is still accepted as an alias of `view=` (the older page and the
 * service MCP use it).
 *
 * ONE client, sequential queries (Supabase session pooler — no fan-out).
 */
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { LIFECYCLE_FUNNEL, type LeadCounts, type LeadSort, type LeadView } from '@/lib/sales-leads';
import { AGENT_FIND, DUE, NEEDS_YOU, OPEN, SORTS, TEAM_USERS_SQL, funnelStored } from '@/lib/sales-leads-sql';

const VIEWS = new Set<LeadView>(['working', 'due', 'must', 'needs_you', 'new', 'contacted', 'replied', 'converted', 'archived', 'all']);
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
  else if (view === 'needs_you') where.push(NEEDS_YOU);
  else if (view === 'contacted') where.push("l.status IN ('contacted', 'replied')");
  else if (view !== 'all') { vals.push(view); where.push(`l.status = $${vals.length}`); }
  const stage = url.searchParams.get('stage') || '';
  if (stage) {
    if (!(LIFECYCLE_FUNNEL as string[]).includes(stage)) return NextResponse.json({ error: `Invalid stage: ${stage}` }, { status: 400 });
    vals.push(stage); where.push(`l.lifecycle_stage = $${vals.length}`);
  }
  if (mine) {
    vals.push(session.userId);
    const me = `$${vals.length}`;
    // A card is approved by the account owner (the prospect's owner), who is not always the back office.
    const sender = `EXISTS (SELECT 1 FROM prospects pm WHERE pm.id = l.prospect_id AND pm.owner_user_id = ${me})`;
    where.push(role === 'responsible' ? `l.responsible_user_id = ${me}`
      : role === 'front' ? `l.front_user_id = ${me}`
      : view === 'needs_you' ? `(l.responsible_user_id = ${me} OR l.front_user_id = ${me} OR ${sender})`
      : `(l.responsible_user_id = ${me} OR l.front_user_id = ${me})`);
  }
  // Agent finds nobody has reached out to are prospects, not leads: hidden unless asked for (finds=1).
  // Without migration 086 (no stored funnel yet) nothing is hidden.
  const finds = url.searchParams.get('finds') === '1';
  const hasStore = await funnelStored();
  const leadsOnly = finds || !hasStore ? 'true' : `NOT ${AGENT_FIND}`;
  if (leadsOnly !== 'true') where.push(leadsOnly);
  const list = url.searchParams.get('list') || '';
  if (list) { vals.push(list); where.push(`l.source = $${vals.length}`); }
  if (q) { vals.push(`%${q}%`); where.push(`(l.full_name ILIKE $${vals.length} OR l.company ILIKE $${vals.length} OR l.title ILIKE $${vals.length} OR l.met_at ILIKE $${vals.length})`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const client = await pool.connect();
  try {
    const { rows: leads } = await client.query(
      `SELECT l.id, l.full_name, l.title, l.company, l.email, l.website, l.linkedin_url, l.description, l.notes, l.dossier, l.journey_stage, l.intro_quality, l.journey_outcome, l.next_step, l.phone,
              l.source, l.status, l.priority, l.rank, l.must_talk, l.met_at,
              l.responsible_user_id, r.name AS responsible_name, l.front_user_id, f.name AS front_name,
              l.last_contact_at, to_char(l.next_contact_at, 'YYYY-MM-DD') AS next_contact_at,
              EXTRACT(day FROM now() - COALESCE(l.last_contact_at, l.created_at))::int AS days_since_contact,
              l.created_at, l.converted_at, l.converted_deal_id, d.name AS converted_deal_name, d.gate AS converted_deal_gate,
              l.prospect_id::text AS prospect_id, ip.name AS icp_name, ou.name AS sender_name, p.owner_user_id::text AS sender_user_id,
              l.lifecycle_stage, l.lifecycle_actor, l.lifecycle_step, l.lifecycle_blocker, l.lifecycle_next_at, l.lifecycle_paused,
              p.linkedin_public_id AS li_public_id, p.network_degree AS li_degree,
              inv.status AS li_invite_status, inv.sent_at AS li_invite_sent_at, inv.accepted_at AS li_accepted_at,
              EXISTS (SELECT 1 FROM outreach_approvals oa WHERE oa.prospect_id = p.id AND oa.kind = 'connect'
                        AND oa.status = 'pending' AND (oa.expires_at IS NULL OR oa.expires_at > now())) AS connect_waiting,
              COALESCE(ev.sent_count, 0) AS sent_count, ev.last_sent_at, ev.last_reply_at,
              COALESCE((SELECT count(*)::int FROM outreach_approvals oa
                         WHERE oa.prospect_id = l.prospect_id AND oa.status = 'pending'
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
         LEFT JOIN prospects p ON p.id = l.prospect_id
         LEFT JOIN icp_profiles ip ON ip.id = p.icp_profile_id
         LEFT JOIN users ou ON ou.id = p.owner_user_id
         LEFT JOIN LATERAL (SELECT i.status, i.sent_at, i.accepted_at FROM linkedin_invitations i
                             WHERE i.prospect_id = p.id ORDER BY i.sent_at DESC NULLS LAST LIMIT 1) inv ON true
         LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE e.kind = 'sent')::int AS sent_count,
                                   max(e.occurred_at) FILTER (WHERE e.kind = 'sent') AS last_sent_at,
                                   max(e.occurred_at) FILTER (WHERE e.kind = 'reply') AS last_reply_at
                              FROM sales_lead_events e WHERE e.lead_id = l.id) ev ON true
         ${clause}
         ORDER BY ${SORTS[sort]}
         LIMIT 300`,
      vals,
    );

    const { rows: c } = await client.query(
      `SELECT count(*) FILTER (WHERE ${OPEN})::int AS working,
              count(*) FILTER (WHERE ${DUE})::int AS due,
              count(*) FILTER (WHERE ${OPEN} AND l.must_talk)::int AS must,
              -- the VIEWER's own queue: leads they back-office, front, or hold the sending account for
              count(*) FILTER (WHERE ${NEEDS_YOU} AND (l.responsible_user_id = $1 OR l.front_user_id = $1
                  OR EXISTS (SELECT 1 FROM prospects pm WHERE pm.id = l.prospect_id AND pm.owner_user_id = $1)))::int AS needs_you,
              count(*) FILTER (WHERE ${NEEDS_YOU})::int AS needs_anyone,
              count(*) FILTER (WHERE l.status = 'new')::int AS new,
              count(*) FILTER (WHERE l.status IN ('contacted', 'replied'))::int AS contacted,
              count(*) FILTER (WHERE l.status = 'replied')::int AS replied,
              count(*) FILTER (WHERE l.status = 'converted')::int AS converted,
              count(*) FILTER (WHERE l.status = 'archived')::int AS archived,
              count(*)::int AS all,
              count(*) FILTER (WHERE l.booking_status = 'scheduled')::int AS booked
         FROM sales_leads l WHERE ${leadsOnly}`,
      [session.userId],
    );
    const counts = c[0] as LeadCounts;
    const agentFinds: number = hasStore ? (await client.query(
      `SELECT count(*)::int AS n FROM sales_leads l WHERE ${OPEN} AND ${AGENT_FIND}`)).rows[0]?.n ?? 0 : 0;

    // The funnel strip: open leads per lifecycle stage (the conductor stores the stage; null = not evaluated yet).
    const { rows: stageRows } = await client.query(
      `SELECT COALESCE(l.lifecycle_stage, 'not_evaluated') AS stage, count(*)::int AS n
         FROM sales_leads l WHERE ${OPEN} AND ${leadsOnly} GROUP BY 1`,
    );
    const funnel: Record<string, number> = Object.fromEntries(stageRows.map((r) => [r.stage, r.n]));

    // The lists the leads came from (each import has its own order numbers), for the List filter.
    const { rows: lists } = await client.query(
      `SELECT COALESCE(l.source, '') AS source, count(*)::int AS n FROM sales_leads l WHERE ${OPEN} AND ${leadsOnly}
        GROUP BY 1 HAVING count(*) > 0 ORDER BY 2 DESC`,
    );

    const { rows: users } = await client.query(TEAM_USERS_SQL);

    return NextResponse.json({ viewer_id: session.userId, viewer_is_admin: session.role === 'admin', leads, counts, funnel, users, lists, view, sort, agent_finds: agentFinds, finds });
  } finally {
    client.release();
  }
}


/** POST /api/sales-leads — add ONE lead by hand (crm_sales_lead_add: dedupe, roles, track record, prospect at once). */
const ADD_FIELDS = ['full_name', 'first_name', 'last_name', 'company', 'title', 'email', 'phone', 'linkedin_url', 'website',
  'met_at', 'notes', 'priority', 'must_talk', 'responsible', 'front', 'list_name'] as const;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const args: Record<string, unknown> = {};
  for (const k of ADD_FIELDS) if (body[k] !== undefined && body[k] !== '') args[k] = body[k];
  if (typeof args.priority === 'string') args.priority = Number(args.priority);
  try {
    const out = await kernelCall('crm_sales_lead_add', args, session.userId);
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
