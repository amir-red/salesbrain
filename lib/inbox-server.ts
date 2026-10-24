/**
 * The Inbox reads (server only): direct SQL over the LinkedIn mirror and the email store (core 082), ONE checked-out
 * client, queries in sequence (Supabase session pooler — never fan out).
 *
 * What is listed: "outreach" conversations. Email = every Gmail thread a SalesBrain email started (so all of them).
 * LinkedIn = a mirrored chat whose person is a prospect or sales lead, or that a SalesBrain message went into;
 * `view: 'all'` shows every LinkedIn chat of the account. Visibility: your own accounts; an admin may pass
 * scope 'team' to read everyone's (read-only — only the owner replies from their account).
 */
import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import type { InboxCounts, InboxFilter, InboxItem, InboxMessage, InboxThread } from '@/lib/inbox';

export interface ListOpts {
  viewerId: string;
  team: boolean;
  channel: 'all' | 'email' | 'linkedin';
  filter: InboxFilter;
  q: string;
  view: 'outreach' | 'all';
  limit: number;
}

/** The prospect behind a LinkedIn chat: member id first, then the slug of the chat's person. Owner's own first. */
const LI_PROSPECT = `
  LEFT JOIN LATERAL (
    SELECT x.id, x.owner_user_id, x.contact_id, x.account_id, x.stage FROM (
      SELECT p.id, p.owner_user_id, p.contact_id, p.account_id, p.stage FROM prospects p
       WHERE t.attendee_provider_id IS NOT NULL AND p.linkedin_member_id = t.attendee_provider_id
      UNION ALL
      SELECT p.id, p.owner_user_id, p.contact_id, p.account_id, p.stage FROM channel_handles h
        JOIN prospects p ON lower(p.linkedin_public_id) = lower(h.handle)
       WHERE t.person_id IS NOT NULL AND h.person_id = t.person_id AND h.channel = 'linkedin'
    ) x ORDER BY (x.owner_user_id = la.owner_user_id) DESC, (x.stage = 'P9_ARCHIVED') LIMIT 1
  ) pr ON true`;

const LI_UNREAD = `(t.last_from_them AND t.last_message_at > COALESCE(t.inbox_seen_at, '-infinity'::timestamptz) AND t.state <> 'done')`;
const EM_UNREAD = `(t.last_from_them AND t.last_message_at > COALESCE(t.inbox_seen_at, '-infinity'::timestamptz) AND t.state <> 'done')`;

function linkedinSql(o: ListOpts, vals: unknown[], forCount = false): string {
  const where: string[] = ['t.is_company = false', 'la.revoked_at IS NULL', 't.last_message_at IS NOT NULL'];
  if (!o.team) { vals.push(o.viewerId); where.push(`la.owner_user_id = $${vals.length}`); }
  if (o.view === 'outreach') {
    where.push(`(pr.id IS NOT NULL OR EXISTS (SELECT 1 FROM outreach_approvals oa WHERE oa.linkedin_thread_id = t.id))`);
  }
  if (!forCount) {
    if (o.filter === 'needs_reply') where.push(`t.state = 'needs_reply'`);
    else if (o.filter === 'unread') where.push(LI_UNREAD);
    else if (o.filter === 'done') where.push(`t.state IN ('done', 'ignored')`);
    else where.push(`t.state <> 'ignored'`);
    if (o.q) {
      vals.push(`%${o.q}%`);
      const n = vals.length;
      where.push(`(t.attendee_name ILIKE $${n} OR t.attendee_headline ILIKE $${n} OR a.name ILIKE $${n})`);
    }
  }
  return `
    SELECT 'linkedin' AS channel, t.id::text AS id, la.owner_user_id::text AS owner_user_id, u.name AS owner_name,
           COALESCE(c.full_name, t.attendee_name) AS name, COALESCE(c.title, t.attendee_headline) AS headline,
           a.name AS company, NULL::text AS email, NULL::text AS subject,
           (SELECT left(m.text, 180) FROM linkedin_messages m WHERE m.thread_id = t.id
             ORDER BY m.sent_at DESC NULLS LAST LIMIT 1) AS snippet,
           t.last_message_at, COALESCE(t.last_from_them, false) AS last_from_them, t.state,
           ${LI_UNREAD} AS unread, pr.id::text AS prospect_id, sl.id::text AS sales_lead_id,
           (SELECT cc.name FROM campaign_enrollments ce JOIN campaigns cc ON cc.id = ce.campaign_id
             WHERE ce.prospect_id = pr.id ORDER BY ce.status = 'active' DESC, ce.entered_node_at DESC LIMIT 1) AS campaign_name
      FROM linkedin_threads t
      JOIN linkedin_accounts la ON la.id = t.account_id
      JOIN users u ON u.id = la.owner_user_id
      ${LI_PROSPECT}
      LEFT JOIN contacts c ON c.id = pr.contact_id
      LEFT JOIN accounts a ON a.id = pr.account_id
      LEFT JOIN sales_leads sl ON sl.prospect_id = pr.id
     WHERE ${where.join(' AND ')}`;
}

function emailSql(o: ListOpts, vals: unknown[], forCount = false): string {
  const where: string[] = ['t.last_message_at IS NOT NULL'];
  if (!o.team) { vals.push(o.viewerId); where.push(`t.owner_user_id = $${vals.length}`); }
  if (!forCount) {
    if (o.filter === 'needs_reply') where.push(`t.state = 'needs_reply'`);
    else if (o.filter === 'unread') where.push(EM_UNREAD);
    else if (o.filter === 'done') where.push(`t.state = 'done'`);
    if (o.q) {
      vals.push(`%${o.q}%`);
      const n = vals.length;
      where.push(`(COALESCE(c.full_name, t.counterpart_name) ILIKE $${n} OR t.counterpart_email ILIKE $${n}
                   OR t.subject ILIKE $${n} OR a.name ILIKE $${n})`);
    }
  }
  return `
    SELECT 'email' AS channel, t.id::text AS id, t.owner_user_id::text AS owner_user_id, u.name AS owner_name,
           COALESCE(c.full_name, t.counterpart_name, t.counterpart_email) AS name, c.title AS headline,
           a.name AS company, t.counterpart_email AS email, t.subject, t.last_snippet AS snippet,
           t.last_message_at, t.last_from_them, t.state, ${EM_UNREAD} AS unread,
           t.prospect_id::text AS prospect_id, sl.id::text AS sales_lead_id,
           (SELECT cc.name FROM campaign_enrollments ce JOIN campaigns cc ON cc.id = ce.campaign_id
             WHERE ce.prospect_id = t.prospect_id ORDER BY ce.status = 'active' DESC, ce.entered_node_at DESC LIMIT 1) AS campaign_name
      FROM email_threads t
      JOIN users u ON u.id = t.owner_user_id
      LEFT JOIN prospects p ON p.id = t.prospect_id
      LEFT JOIN contacts c ON c.id = p.contact_id
      LEFT JOIN accounts a ON a.id = p.account_id
      LEFT JOIN sales_leads sl ON sl.prospect_id = t.prospect_id
     WHERE ${where.join(' AND ')}`;
}

function iso(v: unknown): string | null {
  return v instanceof Date ? v.toISOString() : (v as string | null) ?? null;
}

function toItem(r: Record<string, unknown>): InboxItem {
  return { ...(r as unknown as InboxItem), last_message_at: iso(r.last_message_at), unread: !!r.unread, last_from_them: !!r.last_from_them };
}

export async function listInbox(o: ListOpts): Promise<{ items: InboxItem[]; counts: InboxCounts }> {
  const client = await pool.connect();
  try {
    const vals: unknown[] = [];
    const parts: string[] = [];
    if (o.channel !== 'email') parts.push(linkedinSql(o, vals));
    if (o.channel !== 'linkedin') parts.push(emailSql(o, vals));
    vals.push(o.limit);
    const { rows } = await client.query(
      `SELECT * FROM (${parts.join(' UNION ALL ')}) x ORDER BY last_message_at DESC NULLS LAST LIMIT $${vals.length}`, vals);
    const counts = await countInbox(client, { ...o, filter: 'all', q: '' });
    return { items: rows.map(toItem), counts };
  } finally {
    client.release();
  }
}

async function countInbox(client: PoolClient, o: ListOpts): Promise<InboxCounts> {
  const vals: unknown[] = [];
  const li = linkedinSql(o, vals, true);
  const em = emailSql(o, vals, true);
  const { rows } = await client.query(
    `SELECT channel, count(*) FILTER (WHERE state = 'needs_reply')::int AS needs_reply,
            count(*) FILTER (WHERE unread)::int AS unread, count(*)::int AS total
       FROM (${li} UNION ALL ${em}) x WHERE state <> 'ignored' GROUP BY channel`, vals);
  const by = Object.fromEntries(rows.map((r) => [r.channel, r]));
  return {
    needs_reply: (by.linkedin?.needs_reply ?? 0) + (by.email?.needs_reply ?? 0),
    unread: (by.linkedin?.unread ?? 0) + (by.email?.unread ?? 0),
    email: by.email?.total ?? 0,
    linkedin: by.linkedin?.total ?? 0,
  };
}

/** The sidebar badge: my conversations waiting for my answer. One cheap query. */
export async function needsReplyCount(viewerId: string): Promise<number> {
  const client = await pool.connect();
  try {
    const c = await countInbox(client, { viewerId, team: false, channel: 'all', filter: 'all', q: '', view: 'outreach', limit: 0 });
    return c.needs_reply;
  } finally {
    client.release();
  }
}

/** One conversation, or null when it does not exist or the viewer may not see it. Marks it seen for its owner. */
export async function getThread(channel: 'email' | 'linkedin', id: string, viewer: { userId: string; admin: boolean }):
  Promise<InboxThread | null> {
  const client = await pool.connect();
  try {
    const o: ListOpts = { viewerId: viewer.userId, team: true, channel, filter: 'all', q: '', view: 'all', limit: 1 };
    const vals: unknown[] = [];
    const base = channel === 'linkedin' ? linkedinSql(o, vals, true) : emailSql(o, vals, true);
    vals.push(id);
    const { rows } = await client.query(`SELECT * FROM (${base}) x WHERE x.id = $${vals.length}`, vals);
    const head = rows[0];
    if (!head) return null;
    const mine = head.owner_user_id === viewer.userId;
    if (!mine && !viewer.admin) return null;

    let messages: InboxMessage[] = [];
    let profile_url: string | null = null;
    let mailbox: string | null = null;
    if (channel === 'linkedin') {
      const t = await client.query(`SELECT attendee_profile_url FROM linkedin_threads WHERE id = $1`, [id]);
      profile_url = t.rows[0]?.attendee_profile_url ?? null;
      const m = await client.query(
        `SELECT id::text, is_sender AS from_me, COALESCE(text, '') AS text, sent_at FROM linkedin_messages
          WHERE thread_id = $1 ORDER BY sent_at NULLS FIRST, created_at LIMIT 500`, [id]);
      messages = m.rows.map((r) => ({ id: r.id, from_me: r.from_me, text: r.text, sent_at: iso(r.sent_at) }));
    } else {
      const t = await client.query(`SELECT mailbox, gmail_thread_id FROM email_threads WHERE id = $1`, [id]);
      mailbox = t.rows[0]?.mailbox ?? null;
      const m = await client.query(
        `SELECT id::text, from_me, COALESCE(body, '') AS text, sent_at, from_header AS "from", subject FROM email_messages
          WHERE thread_id = $1 ORDER BY sent_at NULLS FIRST, created_at LIMIT 500`, [id]);
      messages = m.rows.map((r) => ({ id: r.id, from_me: r.from_me, text: r.text, sent_at: iso(r.sent_at), from: r.from, subject: r.subject }));
    }
    // Replies typed here that the send gate is holding (quiet hours, a cap): shown as "waiting to be sent".
    const pend = await client.query(
      `SELECT o.id::text, o.message, o.created_at FROM outreach_approvals o
        WHERE o.drafted_by = 'inbox' AND o.status = 'approved' AND o.consumed_at IS NULL
          AND ${channel === 'linkedin' ? 'o.linkedin_thread_id = $1::uuid'
            : `o.email_thread_id = (SELECT gmail_thread_id FROM email_threads WHERE id = $1) AND o.owner_user_id = (SELECT owner_user_id FROM email_threads WHERE id = $1)`}
        ORDER BY o.created_at`, [id]);
    messages = messages.concat(pend.rows.map((r) => ({ id: `pending:${r.id}`, from_me: true, text: r.message, sent_at: iso(r.created_at), pending: true })));

    let stage: string | null = null;
    if (head.prospect_id) {
      const s = await client.query(`SELECT stage FROM prospects WHERE id = $1`, [head.prospect_id]);
      stage = s.rows[0]?.stage ?? null;
    }
    if (mine) {
      await client.query(`UPDATE ${channel === 'linkedin' ? 'linkedin_threads' : 'email_threads'} SET inbox_seen_at = now() WHERE id = $1`, [id]);
    }
    let reply_note: string | null = null;
    if (!mine) reply_note = `Sent from ${head.owner_name || 'a teammate'}'s ${channel === 'linkedin' ? 'LinkedIn' : 'mailbox'} — only they can reply.`;
    return {
      ...toItem(head), unread: mine ? false : !!head.unread, profile_url, mailbox, messages, can_reply: mine, reply_note,
      prospect_stage: stage,
    };
  } finally {
    client.release();
  }
}

/** done / reopen — the conversation's owner or an admin. Returns false when not allowed or not found. */
export async function setThreadState(channel: 'email' | 'linkedin', id: string, action: 'done' | 'reopen',
  viewer: { userId: string; admin: boolean }): Promise<boolean> {
  const table = channel === 'linkedin' ? 'linkedin_threads' : 'email_threads';
  const owner = channel === 'linkedin'
    ? `(SELECT la.owner_user_id FROM linkedin_accounts la WHERE la.id = t.account_id)`
    : 't.owner_user_id';
  const set = action === 'done' ? `'done'` : `CASE WHEN t.last_from_them THEN 'needs_reply' ELSE 'waiting' END`;
  const { rowCount } = await pool.query(
    `UPDATE ${table} t SET state = ${set} WHERE t.id = $1 AND ($2::boolean OR ${owner} = $3)`, [id, viewer.admin, viewer.userId]);
  return (rowCount ?? 0) > 0;
}
