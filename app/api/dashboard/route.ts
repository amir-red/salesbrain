import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { FUNNEL_LANES } from '@/lib/funnel';
import {
  DASH_PERIODS, DASH_STAGES, periodBounds,
  type DashPeriod, type DashStage, type DashboardPayload, type DashList, type DashReply, type DashWeek,
} from '@/lib/dashboard';

// Cumulative steps over person_funnel.stage, as on the Lists page (api/icp/overview): everyone who got AT LEAST that far.
const CONTACTED = `('lead_contacted','lead_engaged','lead_meeting','lead_qualified','opportunity','client')`;
const ANSWERED = `('lead_engaged','lead_meeting','lead_qualified','opportunity','client')`;
const OPPORTUNITY = `('opportunity','client')`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEEKS = 12;

/**
 * GET /api/dashboard?period=&icp_id=&owner=&lane=  — what /dashboard needs besides the funnel itself (GET /api/funnel):
 * people entering each stage in the period and in the same stretch of the period before, the last 12 weeks, the most
 * active lists and the latest answers. Reads person_funnel + funnel_events (core 086), the stored projection the
 * kernel refreshes hourly and on read.
 *
 * Aggregates for every signed-in teammate (the funnel rule). The latest answers name the person and quote the first
 * line, like the org-wide /sales-leads track record does. `owner` = a user id or 'me'.
 *
 * ONE checked-out client, queries in sequence (Supabase pooler in session mode, shared with production).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const period = (q.get('period') || 'month') as DashPeriod;
  if (!(period in DASH_PERIODS)) return NextResponse.json({ error: 'unknown period' }, { status: 400 });
  const icp = q.get('icp_id') || null;
  if (icp && !UUID.test(icp)) return NextResponse.json({ error: 'icp_id must be a list id' }, { status: 400 });
  const ownerQ = q.get('owner') || null;
  const owner = ownerQ === 'me' ? session.userId : ownerQ;
  if (owner && !UUID.test(owner)) return NextResponse.json({ error: 'owner must be a user id or me' }, { status: 400 });
  const lane = q.get('lane') || null;
  if (lane && !(lane in FUNNEL_LANES)) return NextResponse.json({ error: 'unknown lane' }, { status: 400 });

  const b = periodBounds(period);
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86400000);
  const firstWeek = new Date(monday.getTime() - (WEEKS - 1) * 7 * 86400000);
  const stages = [...DASH_STAGES];
  const zero = () => Object.fromEntries(stages.map((s) => [s, 0])) as Record<DashStage, number>;

  const slice = `WITH pf AS (
      SELECT person_key, stage, icp_ids, full_name, company, lead_id, prospect_id, person_id FROM person_funnel
       WHERE ($1::uuid IS NULL OR $1::uuid = ANY(icp_ids))
         AND ($2::uuid IS NULL OR $2::uuid = ANY(user_ids))
         AND ($3::text IS NULL OR lane = $3::text))`;
  const base = [icp, owner, lane];

  const client = await pool.connect();
  try {
    const has = await client.query(`SELECT to_regclass('public.funnel_events') IS NOT NULL AS ok`);
    if (!has.rows[0]?.ok) {
      const empty: DashboardPayload = {
        period: { key: period, start: b.start.toISOString(), end: b.end.toISOString(), prev_start: b.prevStart.toISOString(), prev_end: b.prevEnd.toISOString() },
        current: zero(), previous: zero(), weeks: [], lists: [], replies: [], history: false,
      };
      return NextResponse.json(empty);
    }

    const per = await client.query(
      `${slice}
       SELECT e.to_stage,
              count(DISTINCT e.person_key) FILTER (WHERE e.occurred_at >= $4 AND e.occurred_at < $5)::int AS cur,
              count(DISTINCT e.person_key) FILTER (WHERE e.occurred_at >= $6 AND e.occurred_at < $7)::int AS prev
         FROM funnel_events e JOIN pf USING (person_key)
        WHERE e.exit IS NULL AND e.occurred_at >= $6 AND e.to_stage = ANY($8::text[])
        GROUP BY 1`,
      [...base, b.start, b.end, b.prevStart, b.prevEnd, stages]);
    const current = zero(); const previous = zero();
    for (const r of per.rows) { current[r.to_stage as DashStage] = r.cur; previous[r.to_stage as DashStage] = r.prev; }

    const wk = await client.query(
      `${slice}
       SELECT to_char(date_trunc('week', e.occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week, e.to_stage,
              count(DISTINCT e.person_key)::int AS n
         FROM funnel_events e JOIN pf USING (person_key)
        WHERE e.exit IS NULL AND e.occurred_at >= $4 AND e.to_stage = ANY($5::text[])
        GROUP BY 1, 2`,
      [...base, firstWeek, stages]);
    const weeks: DashWeek[] = Array.from({ length: WEEKS }, (_, i) => ({
      week: new Date(firstWeek.getTime() + i * 7 * 86400000).toISOString().slice(0, 10), counts: zero(),
    }));
    const byWeek = new Map(weeks.map((w) => [w.week, w]));
    for (const r of wk.rows) { const w = byWeek.get(r.week); if (w) w.counts[r.to_stage as DashStage] = r.n; }

    const ls = await client.query(
      `${slice}
       SELECT i.id, i.name, u.name AS owner_name, count(*)::int AS found,
              count(*) FILTER (WHERE pf.stage IN ${CONTACTED})::int AS contacted,
              count(*) FILTER (WHERE pf.stage IN ${ANSWERED})::int AS answered,
              count(*) FILTER (WHERE pf.stage IN ${OPPORTUNITY})::int AS opportunity
         FROM pf CROSS JOIN LATERAL unnest(pf.icp_ids) AS li(icp_id)
         JOIN icp_profiles i ON i.id = li.icp_id AND i.is_active IS NOT FALSE
         JOIN users u ON u.id = i.owner_user_id
        WHERE ($1::uuid IS NULL OR i.id = $1::uuid)
        GROUP BY i.id, i.name, u.name
       HAVING count(*) FILTER (WHERE pf.stage IN ${CONTACTED}) > 0
        ORDER BY contacted DESC, found DESC
        LIMIT 5`, base);
    const lists = ls.rows as DashList[];

    const rp = await client.query(
      `${slice}
       SELECT * FROM (
         -- the newest answer per person, so one chatty thread does not fill the card
         SELECT DISTINCT ON (f.person_key)
                r.channel, left(r.snippet, 160) AS snippet, COALESCE(r.received_at, r.created_at) AS at,
                f.full_name, f.company, f.lead_id, u.name AS owner_name
           FROM reply_events r
           JOIN users u ON u.id = r.owner_user_id
           JOIN LATERAL (SELECT pf.person_key, pf.full_name, pf.company, pf.lead_id FROM pf
                          WHERE pf.prospect_id = r.prospect_id OR (r.person_id IS NOT NULL AND pf.person_id = r.person_id)
                          LIMIT 1) f ON true
          ORDER BY f.person_key, COALESCE(r.received_at, r.created_at) DESC) x
        ORDER BY at DESC
        LIMIT 6`, base);
    const replies = rp.rows.map((r) => ({ ...r, at: new Date(r.at).toISOString() })) as DashReply[];

    const out: DashboardPayload = {
      period: { key: period, start: b.start.toISOString(), end: b.end.toISOString(), prev_start: b.prevStart.toISOString(), prev_end: b.prevEnd.toISOString() },
      current, previous, weeks, lists, replies, history: true,
    };
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not load the dashboard' }, { status: 500 });
  } finally {
    client.release();
  }
}
