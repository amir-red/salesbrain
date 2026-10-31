import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { visibleIcp } from '@/lib/icp-server';
import { connectQuota } from '@/lib/connect-quota-server';
import { FUNNEL_COUNTS } from '@/lib/funnel-sql';
import type { JourneyCampaign, JourneyEvent, JourneyPayload, LaneKey, LanePerson } from '@/lib/icp-journey';
import type { ListFunnel } from '@/lib/icp-panel';

/**
 * GET /api/icp/[id]/journey — the list as "what should I do next": five lanes of people (answer, message, send,
 * follow up, pick), what happened in the last day, what the machinery holds in progress, the campaigns that send
 * to the list, the connect cap left today and the funnel. Direct SQL, ONE checked-out client, queries in sequence
 * (pooler rule); every lane is capped at 50 rows. Nothing here writes.
 *
 * Who sees it: anyone signed in (lists are shared, §5.bo); acting on a row still goes through the row's own
 * route, which checks owner/admin and runs as the lead's owner.
 */
// `ts.total` is the trust score (095): within a lane people sort by it after their priority.
const PEOPLE = `p.id AS prospect_id, c.full_name, c.title, a.name AS company, p.icp_score, p.priority, p.card_id AS lead_id,
  ts.total AS trust_total, ts.why AS trust_why`;
const JOINS = `LEFT JOIN contacts c ON c.id = p.contact_id LEFT JOIN accounts a ON a.id = p.account_id
  LEFT JOIN trust_scores ts ON ts.prospect_id = p.id`;
const RANK = `ts.total DESC NULLS LAST, p.icp_score DESC NULLS LAST`;
/** A LinkedIn conversation with this person on an active account of the lead's owner (by person, else by member id). */
const THREAD_MATCH = `JOIN linkedin_accounts la ON la.id = t.account_id AND la.revoked_at IS NULL AND la.owner_user_id = p.owner_user_id
   WHERE ((p.person_id IS NOT NULL AND t.person_id = p.person_id)
       OR (p.linkedin_member_id IS NOT NULL AND t.attendee_provider_id = p.linkedin_member_id))`;
const OPEN = `p.icp_profile_id = $1 AND p.converted_deal_id IS NULL AND p.stage NOT IN ('P8_DISQUALIFIED', 'P9_ARCHIVED')`;
const HAS_PROFILE = `(p.linkedin_public_id IS NOT NULL OR p.linkedin_member_id IS NOT NULL)`;
const DAY = `now() - interval '24 hours'`;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const icp = await visibleIcp(params.id, session);
  if (!icp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const id = icp.id;

  const client = await pool.connect();
  try {
    const q = (sql: string, vals: unknown[] = [id]) => client.query(sql, vals);

    // ── Answer: a reply nobody answered yet (LinkedIn thread or email thread in needs_reply) ───────────────
    const answer = await q(
      `SELECT ${PEOPLE}, x.channel, x.thread_id, x.snippet, x.at
         FROM leads p ${JOINS}
         JOIN LATERAL (
           SELECT 'linkedin' AS channel, t.id AS thread_id, t.last_message_at AS at,
                  (SELECT m.text FROM linkedin_messages m WHERE m.thread_id = t.id AND NOT m.is_sender
                    ORDER BY m.sent_at DESC NULLS LAST LIMIT 1) AS snippet
             FROM linkedin_threads t ${THREAD_MATCH}
              AND t.state = 'needs_reply' AND COALESCE(t.last_from_them, false)
           UNION ALL
           SELECT 'email', e.id, e.last_message_at, e.last_snippet
             FROM email_threads e WHERE e.prospect_id = p.id AND e.state = 'needs_reply'
           ORDER BY at DESC NULLS LAST LIMIT 1) x ON true
        WHERE ${OPEN}
        ORDER BY x.at DESC NULLS LAST LIMIT 50`);

    // ── Message: accepted our request (or already 1st degree), no conversation yet ─────────────────────────
    const message = await q(
      `SELECT ${PEOPLE}, p.network_degree, inv.accepted_at, dr.id AS approval_id, dr.created_at AS draft_at
         FROM leads p ${JOINS}
         LEFT JOIN LATERAL (
           SELECT i.accepted_at FROM linkedin_invitations i
            WHERE i.owner_user_id = p.owner_user_id AND i.status = 'accepted'
              AND (i.prospect_id = p.id OR lower(i.public_identifier) = lower(p.linkedin_public_id)
                   OR i.provider_id = p.linkedin_member_id)
            ORDER BY i.accepted_at DESC NULLS LAST LIMIT 1) inv ON true
         LEFT JOIN LATERAL (
           SELECT oa.id, oa.created_at FROM outreach_approvals oa
            WHERE oa.prospect_id = p.id AND oa.status = 'pending' AND oa.kind = 'outreach' AND oa.channel = 'linkedin'
            ORDER BY oa.created_at DESC LIMIT 1) dr ON true
        WHERE ${OPEN} AND ${HAS_PROFILE}
          AND p.stage NOT IN ('P5_SENT', 'P6_REPLIED', 'P7_QUALIFIED')
          AND (p.network_degree = '1' OR inv.accepted_at IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM linkedin_threads t ${THREAD_MATCH})
        ORDER BY (dr.id IS NOT NULL) DESC, inv.accepted_at DESC NULLS LAST, p.priority NULLS LAST, ${RANK}
        LIMIT 50`);

    // ── Send: connection requests filed and waiting for the owner's tap ────────────────────────────────────
    const send = await q(
      `SELECT ${PEOPLE}, oa.id AS approval_id, oa.created_at AS at, oa.message AS note
         FROM outreach_approvals oa JOIN leads p ON p.id = oa.prospect_id ${JOINS}
        WHERE p.icp_profile_id = $1 AND oa.kind = 'connect' AND oa.status = 'pending'
        ORDER BY p.priority NULLS LAST, ${RANK}, oa.created_at LIMIT 50`);

    // ── Follow up: messaged, no answer, the cadence timer is due (or a follow-up draft already waits) ──────
    const follow = await q(
      `SELECT ${PEOPLE}, p.last_contacted_at, p.next_followup_at, p.touch_count, dr.id AS approval_id,
              (SELECT t.id FROM linkedin_threads t ${THREAD_MATCH} ORDER BY t.last_message_at DESC NULLS LAST LIMIT 1) AS thread_id
         FROM leads p ${JOINS}
         LEFT JOIN LATERAL (
           SELECT oa.id FROM outreach_approvals oa
            WHERE oa.prospect_id = p.id AND oa.status = 'pending' AND oa.kind = 'followup'
            ORDER BY oa.created_at DESC LIMIT 1) dr ON true
        WHERE ${OPEN} AND p.stage = 'P5_SENT'
          AND (p.next_followup_at <= now() OR dr.id IS NOT NULL)
        ORDER BY (dr.id IS NOT NULL) DESC, p.next_followup_at ASC NULLS LAST LIMIT 50`);

    // ── Pick: the profile search found more than one person ───────────────────────────────────────────────
    const pick = await q(
      `SELECT ${PEOPLE}, lk.created_at AS at, lk.result,
              jsonb_array_length(COALESCE(lk.detail->'candidates', '[]'::jsonb)) AS n_candidates
         FROM leads p ${JOINS}
         JOIN LATERAL (SELECT e.result, e.detail, e.created_at FROM prospect_enrichment e
                        WHERE e.prospect_id = p.id AND e.kind = 'linkedin' ORDER BY e.created_at DESC LIMIT 1) lk ON true
        WHERE ${OPEN} AND p.linkedin_public_id IS NULL AND p.linkedin_member_id IS NULL
          AND lk.result IN ('ambiguous', 'candidates')
        ORDER BY p.priority NULLS LAST, ${RANK} LIMIT 50`);

    // ── Counts behind the lanes ────────────────────────────────────────────────────────────────────────────
    const counts = (await q(
      `SELECT
         count(*) FILTER (WHERE ${HAS_PROFILE} AND p.network_degree IS DISTINCT FROM '1'
                            AND p.stage IN ('P0_IMPORTED','P1_ENRICHED','P2_ICP_CHECKED','P3_RESEARCH_READY','P4_OUTREACH_DRAFTED')
                            AND NOT EXISTS (SELECT 1 FROM linkedin_invitations i WHERE i.owner_user_id = p.owner_user_id
                                             AND (i.prospect_id = p.id OR lower(i.public_identifier) = lower(p.linkedin_public_id)
                                                  OR i.provider_id = p.linkedin_member_id))
                            AND NOT EXISTS (SELECT 1 FROM outreach_approvals oa WHERE oa.prospect_id = p.id AND oa.kind = 'connect'
                                             AND oa.status IN ('pending', 'approved')))::int AS send_ready,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM prospect_enrichment e WHERE e.prospect_id = p.id AND e.kind = 'linkedin'
                                         AND e.result = 'found' AND e.created_at > now() - interval '5 hours'))::int AS fresh_profiles,
         count(*) FILTER (WHERE p.linkedin_public_id IS NULL AND p.linkedin_member_id IS NULL
                            AND p.stage IN ('P0_IMPORTED','P1_ENRICHED','P2_ICP_CHECKED','P3_RESEARCH_READY'))::int AS no_profile,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM linkedin_invitations i WHERE i.owner_user_id = p.owner_user_id AND i.status = 'pending'
                                         AND (i.prospect_id = p.id OR lower(i.public_identifier) = lower(p.linkedin_public_id)
                                              OR i.provider_id = p.linkedin_member_id)))::int AS requests_pending,
         count(*) FILTER (WHERE p.stage = 'P5_SENT' AND p.next_followup_at > now())::int AS followups_timed,
         count(*) FILTER (WHERE p.stage = 'P5_SENT')::int AS messaged_waiting,
         count(*)::int AS total
       FROM leads p WHERE ${OPEN}`)).rows[0];

    const connect = await connectQuota(client, icp.owner_user_id);

    // ── What happened in the last day ──────────────────────────────────────────────────────────────────────
    const raw = await q(
      `SELECT 'reply' AS kind, c.full_name, a.name AS company, COALESCE(r.received_at, r.created_at) AS at, p.id AS prospect_id, r.snippet AS extra
         FROM reply_events r JOIN leads p ON p.id = r.prospect_id ${JOINS}
        WHERE p.icp_profile_id = $1 AND COALESCE(r.received_at, r.created_at) > ${DAY}
       UNION ALL
       SELECT 'accepted', c.full_name, a.name, i.accepted_at, p.id, NULL
         FROM linkedin_invitations i JOIN leads p ON p.id = i.prospect_id ${JOINS}
        WHERE p.icp_profile_id = $1 AND i.status = 'accepted' AND i.accepted_at > ${DAY}
       UNION ALL
       SELECT 'sent', c.full_name, a.name, oa.sent_at, p.id, oa.kind
         FROM outreach_approvals oa JOIN leads p ON p.id = oa.prospect_id ${JOINS}
        WHERE p.icp_profile_id = $1 AND oa.status = 'sent' AND oa.sent_at > ${DAY} AND oa.kind IN ('outreach', 'followup')
       UNION ALL
       SELECT 'request', c.full_name, a.name, i.sent_at, p.id, i.status
         FROM linkedin_invitations i JOIN leads p ON p.id = i.prospect_id ${JOINS}
        WHERE p.icp_profile_id = $1 AND i.sent_at > ${DAY}
       UNION ALL
       SELECT 'found', c.full_name, a.name, e.created_at, p.id, e.result
         FROM prospect_enrichment e JOIN leads p ON p.id = e.prospect_id ${JOINS}
        WHERE p.icp_profile_id = $1 AND e.kind = 'linkedin' AND e.result IN ('found', 'ambiguous', 'candidates') AND e.created_at > ${DAY}
       UNION ALL
       SELECT 'run', r.source, NULL, r.finished_at, NULL, r.created::text
         FROM agent_runs r WHERE r.icp_profile_id = $1 AND r.status = 'ok' AND r.finished_at > ${DAY} AND COALESCE(r.created, 0) > 0
       ORDER BY at DESC NULLS LAST LIMIT 80`);

    let campaigns: JourneyCampaign[] = [];
    try {
      campaigns = (await q(
        `SELECT cp.id, cp.name, cp.status, cp.launched_at, u.name AS owner_name,
                (SELECT count(*) FROM campaign_enrollments e WHERE e.campaign_id = cp.id)::int AS enrolled,
                (SELECT count(*) FROM campaign_enrollments e WHERE e.campaign_id = cp.id AND e.status = 'active')::int AS active,
                (SELECT count(*) FROM campaign_enrollments e WHERE e.campaign_id = cp.id AND e.status = 'handed_off')::int AS handed_off,
                (SELECT count(*) FROM outreach_approvals oa WHERE oa.campaign_id = cp.id AND oa.status = 'sent')::int AS sent,
                (SELECT count(*) FROM campaign_cards k WHERE k.campaign_id = cp.id AND k.status = 'pending')::int AS cards_waiting,
                (SELECT k.id FROM campaign_cards k WHERE k.campaign_id = cp.id AND k.status = 'pending' ORDER BY k.created_at DESC LIMIT 1) AS card_id
           FROM campaigns cp
           JOIN campaign_lists cl ON cl.campaign_id = cp.id AND cl.icp_profile_id = $1 AND cl.include
           LEFT JOIN users u ON u.id = cp.owner_user_id
          WHERE cp.status <> 'archived'
          ORDER BY (cp.status = 'live') DESC, (cp.status = 'paused') DESC, cp.updated_at DESC`)).rows as JourneyCampaign[];
    } catch { campaigns = []; }

    let funnel: ListFunnel | null = null;
    try { funnel = ((await q(`SELECT ${FUNNEL_COUNTS} FROM person_funnel WHERE $1::uuid = ANY(icp_ids)`)).rows[0] as ListFunnel) ?? null; }
    catch { funnel = null; }

    // Whose LinkedIn sends for this list: the sender seat, else the back office, else the owner (085 / 094).
    const seat = (await q(
      `SELECT u.id, u.name, i.daily_connect
         FROM icp_profiles i JOIN users u ON u.id = COALESCE(i.sender_user_id, i.responsible_user_id, i.owner_user_id)
        WHERE i.id = $1`, [id])).rows[0] as { id: string; name: string; daily_connect: 'off' | 'card' | 'auto' } | undefined;
    const senderId = seat?.id ?? icp.owner_user_id;
    const sender = (await q(
      `SELECT la.id IS NOT NULL AS linkedin, COALESCE(la.premium_features::text, '') ILIKE '%sales_navigator%' AS sales_navigator
         FROM (SELECT 1) one LEFT JOIN linkedin_accounts la ON la.owner_user_id = $1 AND la.revoked_at IS NULL LIMIT 1`,
      [senderId])).rows[0] ?? { linkedin: false, sales_navigator: false };
    let lastBatch: JourneyPayload['sender']['last_batch'] = null;
    try {
      const b = (await q(
        `SELECT mode, status, size, result, created_at FROM connect_batches
          WHERE owner_user_id = $1 ORDER BY created_at DESC LIMIT 1`, [senderId])).rows[0];
      if (b) {
        const result = (b.result ?? {}) as { sent?: number; failed?: number };
        lastBatch = { mode: b.mode, status: b.status, size: Number(b.size), at: new Date(b.created_at).toISOString(),
          sent: typeof result.sent === 'number' ? result.sent : null, failed: typeof result.failed === 'number' ? result.failed : null };
      }
    } catch { lastBatch = null; }  // before 094 (no mode column)

    // ── Shape ──────────────────────────────────────────────────────────────────────────────────────────────
    const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
    const person = (r: Record<string, unknown>, extra: Partial<LanePerson>): LanePerson => ({
      prospect_id: String(r.prospect_id), full_name: (r.full_name as string | null) ?? null,
      company: r.company === 'Unknown' ? null : ((r.company as string | null) ?? null), title: (r.title as string | null) ?? null,
      icp_score: r.icp_score === null || r.icp_score === undefined ? null : Number(r.icp_score),
      priority: r.priority === null || r.priority === undefined ? null : Number(r.priority),
      detail: null, at: null, approval_id: null, thread_id: null, channel: null, lead_id: (r.lead_id as string | null) ?? null,
      ...extra,
    });
    const days = (v: unknown) => (v ? Math.max(0, Math.round((Date.now() - new Date(v as string).getTime()) / 86_400_000)) : null);
    const ago = (v: unknown) => { const d = days(v); return d === null ? '' : d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} d ago`; };
    const quote = (s: unknown) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t ? `“${t.length > 90 ? `${t.slice(0, 88)}…` : t}”` : null; };

    const lanes: Record<LaneKey, LanePerson[]> = {
      answer: answer.rows.map((r) => person(r, { detail: quote(r.snippet) ?? `replied ${ago(r.at)}`, at: iso(r.at), thread_id: r.thread_id, channel: r.channel })),
      message: message.rows.map((r) => person(r, {
        detail: `${r.accepted_at ? `accepted ${ago(r.accepted_at)}` : '1st degree · never messaged'}${r.approval_id ? ' · draft ready' : ''}`,
        at: iso(r.accepted_at), approval_id: r.approval_id ?? null, channel: 'linkedin' })),
      send: send.rows.map((r) => person(r, { detail: `${r.priority ? `P${r.priority} · ` : ''}${r.icp_score !== null ? `fit ${r.icp_score}` : 'unscored'}${r.note ? ' · with a note' : ''}`, at: iso(r.at), approval_id: r.approval_id, channel: 'linkedin' })),
      follow: follow.rows.map((r) => person(r, {
        detail: `messaged ${ago(r.last_contacted_at)}${r.touch_count > 1 ? ` · touch ${r.touch_count}` : ''}${r.approval_id ? ' · draft ready' : ''}`,
        at: iso(r.next_followup_at ?? r.last_contacted_at), approval_id: r.approval_id ?? null, thread_id: r.thread_id ?? null, channel: 'linkedin' })),
      pick: pick.rows.map((r) => person(r, { detail: `${r.n_candidates} candidates · searched ${ago(r.at)}`, at: iso(r.at) })),
    };

    // Events: one line per reply / acceptance / message; requests, profile finds and runs are folded into counts.
    const events: JourneyEvent[] = [];
    let requests = 0, found = 0, picks = 0, requestAt: string | null = null, foundAt: string | null = null;
    for (const r of raw.rows) {
      const who = r.full_name ? `${r.full_name}${r.company ? ` (${r.company})` : ''}` : 'Someone';
      const at = iso(r.at) ?? new Date().toISOString();
      if (r.kind === 'reply') events.push({ kind: 'reply', text: `${who} replied`, at, prospect_id: r.prospect_id });
      else if (r.kind === 'accepted') events.push({ kind: 'accepted', text: `${who} accepted your request`, at, prospect_id: r.prospect_id });
      else if (r.kind === 'sent') events.push({ kind: 'sent', text: `${r.extra === 'followup' ? 'Follow-up' : 'Message'} sent to ${who}`, at, prospect_id: r.prospect_id });
      else if (r.kind === 'request') { requests += 1; requestAt = requestAt ?? at; }
      else if (r.kind === 'found') { if (r.extra === 'found') found += 1; else picks += 1; foundAt = foundAt ?? at; }
      else if (r.kind === 'run') events.push({ kind: 'run', text: `Leads Finder found ${r.extra} new ${Number(r.extra) === 1 ? 'person' : 'people'}`, at });
    }
    if (requests) events.push({ kind: 'request', text: `${requests} connection ${requests === 1 ? 'request' : 'requests'} sent`, at: requestAt! });
    if (found || picks) events.push({ kind: 'found', at: foundAt!,
      text: found ? `${found} ${found === 1 ? 'profile' : 'profiles'} found${picks ? ` · ${picks} need your pick` : ''}` : `${picks} ${picks === 1 ? 'profile needs' : 'profiles need'} your pick` });
    events.sort((x, y) => (x.at < y.at ? 1 : -1));

    const payload: JourneyPayload = {
      icp: { id, name: icp.name, owner_user_id: icp.owner_user_id, owner_name: icp.owner_name, total: Number(counts.total ?? 0), paused_at: iso((icp as { paused_at?: string | null }).paused_at),
        daily_connect: seat?.daily_connect ?? 'off' },
      viewer: { user_id: session.userId, is_admin: session.role === 'admin', is_owner: icp.owner_user_id === session.userId, can_edit: Boolean(icp.can_edit) },
      sender: { name: seat?.name ?? icp.owner_name, linkedin: Boolean(sender.linkedin), sales_navigator: Boolean(sender.sales_navigator), last_batch: lastBatch },
      lanes,
      counts: {
        send_ready: Number(counts.send_ready ?? 0), fresh_profiles: Number(counts.fresh_profiles ?? 0), no_profile: Number(counts.no_profile ?? 0),
        requests_pending: Number(counts.requests_pending ?? 0), followups_timed: Number(counts.followups_timed ?? 0), messaged_waiting: Number(counts.messaged_waiting ?? 0),
      },
      connect: { per_day: connect.per_day, per_week: connect.per_week, sent_today: connect.sent_today, sent_week: connect.sent_week,
        remaining: connect.remaining, next_request_at: connect.next_request_at, enabled: connect.enabled },
      events: events.slice(0, 12),
      campaigns,
      funnel,
      generated_at: new Date().toISOString(),
    };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
