/**
 * The Inbox reads (server only): direct SQL over the LinkedIn mirror and the email store (core 082), ONE checked-out
 * client, queries in sequence (Supabase session pooler — never fan out).
 *
 * What is listed: "outreach" conversations. Email = every Gmail thread a SalesBrain email started (so all of them).
 * LinkedIn = a mirrored chat whose person is a prospect or sales lead, or that a SalesBrain message went into;
 * `view: 'all'` shows every LinkedIn chat of the account. Chats (core 100: WhatsApp / iMessage / Telegram) = every
 * stored one; since core 106 that includes groups and people the CRM does not know, which are their OWNER's alone (like
 * personal mail) and are left out of the 'outreach' view.
 * Email (core 102): every connected Google account's whole Primary inbox is stored too (origin 'mailbox'). View
 * 'outreach' = threads our email started or with a person in the CRM; 'all' = everything. A mailbox thread with nobody
 * from the CRM in it is visible to its OWNER only — an admin's team view never lists a teammate's personal mail. Visibility: your own accounts; an admin may pass
 * scope 'team' to read everyone's (read-only — only the owner replies from their account).
 */
import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import type { InboxAttachment, InboxChannel, InboxCounts, InboxFilter, InboxItem, InboxMessage, InboxState, InboxThread, InboxThreadRef, ReplyTarget } from '@/lib/inbox';
import { channelLabel, parseKey, threadKey } from '@/lib/inbox';

const TABLE: Record<InboxChannel, string> = { email: 'email_threads', linkedin: 'linkedin_threads', chat: 'chat_threads' };

/**
 * One row per PERSON (2026-11-09): each channel query also yields `gkey`, the group key —
 * `person:<person id>` when the thread or its prospect has a person node, else `prospect:<prospect id>`, else the
 * thread's own `<channel>:<id>`. Before that last fallback, a stranger's threads still fold on the one identity the
 * channel gives: the same address in the same owner's mail (`em:<owner>:<address>` — a calendar decline and a "nice
 * to meet you" from one person), the same LinkedIn member on one account (`li:<owner>:<member id>`). `listInbox` folds the union on it in TS;
 * `countInbox` counts distinct keys; `getPerson` loads every thread of one key.
 */
function gkeyCol(channel: InboxChannel, personExpr: string, prospectExpr: string, sameExpr?: string): string {
  return `COALESCE('person:' || (${personExpr})::text, 'prospect:' || (${prospectExpr})::text,${sameExpr ? ` ${sameExpr},` : ''} '${channel}:' || t.id::text) AS gkey`;
}

export interface ListOpts {
  viewerId: string;
  team: boolean;
  channel: 'all' | 'email' | 'linkedin' | 'chat';
  filter: InboxFilter;
  q: string;
  view: 'outreach' | 'all';
  limit: number;
  /** email only: one of the viewer's mailboxes (core 102) */
  mailbox?: string | null;
  /** core 103 exists (set by the readers after `plansStored`): the active plan rides on every row */
  plans?: boolean;
}

/** The active conversation plan on a thread, as one json column (NULL when none / before core 103). */
function planCol(channel: InboxChannel, on: boolean | undefined): string {
  if (!on) return 'NULL::jsonb AS plan';
  return `(SELECT jsonb_build_object('id', cp.id, 'decision', cp.decision, 'reason_kind', cp.reason_kind,
             'next_due_at', cp.next_due_at,
             'steps_left', (SELECT count(*) FROM jsonb_array_elements(cp.steps) s WHERE s->>'status' = 'pending'))
             FROM conversation_plans cp WHERE cp.channel = '${channel}' AND cp.thread_id = t.id AND cp.status = 'active') AS plan`;
}
const PLANNED = `EXISTS (SELECT 1 FROM conversation_plans cp WHERE cp.channel = %CH% AND cp.thread_id = t.id AND cp.status = 'active')`;
function plannedWhere(channel: InboxChannel, on: boolean | undefined): string {
  return on ? PLANNED.replace('%CH%', `'${channel}'`) : 'false';
}

/** The prospect behind a LinkedIn chat: member id first, then the slug of the chat's person. Owner's own first. */
const LI_PROSPECT = `
  LEFT JOIN LATERAL (
    SELECT x.id, x.owner_user_id, x.contact_id, x.account_id, x.stage, x.person_id FROM (
      SELECT p.id, p.owner_user_id, p.contact_id, p.account_id, p.stage, p.person_id FROM prospects p
       WHERE t.attendee_provider_id IS NOT NULL AND p.linkedin_member_id = t.attendee_provider_id
      UNION ALL
      SELECT p.id, p.owner_user_id, p.contact_id, p.account_id, p.stage, p.person_id FROM channel_handles h
        JOIN prospects p ON lower(p.linkedin_public_id) = lower(h.handle)
       WHERE t.person_id IS NOT NULL AND h.person_id = t.person_id AND h.channel = 'linkedin'
    ) x ORDER BY (x.owner_user_id = la.owner_user_id) DESC, (x.stage = 'P9_ARCHIVED') LIMIT 1
  ) pr ON true`;

const LI_UNREAD = `(t.last_from_them AND t.last_message_at > COALESCE(t.inbox_seen_at, '-infinity'::timestamptz) AND t.state <> 'done')`;
const EM_UNREAD = `(t.last_from_them AND t.last_message_at > COALESCE(t.inbox_seen_at, '-infinity'::timestamptz) AND t.state <> 'done')`;
const CH_UNREAD = EM_UNREAD;

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
    else if (o.filter === 'planned') where.push(plannedWhere('linkedin', o.plans));
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
           ${LI_UNREAD} AS unread, pr.id::text AS prospect_id, t.person_id::text AS person_id, sl.id::text AS sales_lead_id,
           (SELECT cc.name FROM campaign_enrollments ce JOIN campaigns cc ON cc.id = ce.campaign_id
             WHERE ce.prospect_id = pr.id ORDER BY ce.status = 'active' DESC, ce.entered_node_at DESC LIMIT 1) AS campaign_name,
           NULL::text AS app, NULL::text AS mailbox, ${planCol('linkedin', o.plans)},
           ${gkeyCol('linkedin', 'COALESCE(t.person_id, pr.person_id)', 'pr.id', `'li:' || la.owner_user_id::text || ':' || t.attendee_provider_id`)}
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
  vals.push(o.viewerId);
  const me = vals.length;
  if (!o.team) where.push(`t.owner_user_id = $${me}`);
  // Personal mail (a whole-inbox thread with nobody from the CRM in it) is its owner's alone. "In the CRM" = a lead or a
  // contact: a bare person node (made when someone answers a stranger from here) does not open the thread to the team.
  const known = `(t.origin = 'outreach' OR t.prospect_id IS NOT NULL OR (t.person_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM contacts kc WHERE kc.person_id = t.person_id) OR EXISTS (SELECT 1 FROM prospects kp WHERE kp.person_id = t.person_id))))`;
  where.push(`(t.owner_user_id = $${me} OR ${known})`);
  if (o.view === 'outreach') where.push(known);
  if (o.mailbox) { vals.push(o.mailbox); where.push(`lower(COALESCE(t.mailbox, '')) = lower($${vals.length})`); }
  if (!forCount) {
    if (o.filter === 'needs_reply') where.push(`t.state = 'needs_reply'`);
    else if (o.filter === 'unread') where.push(EM_UNREAD);
    else if (o.filter === 'done') where.push(`t.state = 'done'`);
    else if (o.filter === 'planned') where.push(plannedWhere('email', o.plans));
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
           t.prospect_id::text AS prospect_id, t.person_id::text AS person_id, sl.id::text AS sales_lead_id,
           (SELECT cc.name FROM campaign_enrollments ce JOIN campaigns cc ON cc.id = ce.campaign_id
             WHERE ce.prospect_id = t.prospect_id ORDER BY ce.status = 'active' DESC, ce.entered_node_at DESC LIMIT 1) AS campaign_name,
           NULL::text AS app, t.mailbox, ${planCol('email', o.plans)},
           ${gkeyCol('email', 'COALESCE(t.person_id, p.person_id)', 't.prospect_id', `'em:' || t.owner_user_id::text || ':' || lower(NULLIF(t.counterpart_email, ''))`)}
      FROM email_threads t
      JOIN users u ON u.id = t.owner_user_id
      LEFT JOIN prospects p ON p.id = t.prospect_id
      LEFT JOIN contacts c ON c.id = p.contact_id
      LEFT JOIN accounts a ON a.id = p.account_id
      LEFT JOIN sales_leads sl ON sl.prospect_id = t.prospect_id
     WHERE ${where.join(' AND ')}`;
}

function chatSql(o: ListOpts, vals: unknown[], forCount = false): string {
  const where: string[] = ['t.last_message_at IS NOT NULL'];
  vals.push(o.viewerId);
  const me = vals.length;
  if (!o.team) where.push(`t.owner_user_id = $${me}`);
  // A group, or someone nobody has in the CRM (core 106), is its owner's alone: a teammate's team view never lists it.
  const known = `(NOT t.is_group AND (t.prospect_id IS NOT NULL OR (t.person_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM contacts kc WHERE kc.person_id = t.person_id) OR EXISTS (SELECT 1 FROM prospects kp WHERE kp.person_id = t.person_id)))))`;
  where.push(`(t.owner_user_id = $${me} OR ${known})`);
  if (o.view === 'outreach') where.push(known);
  if (!forCount) {
    if (o.filter === 'needs_reply') where.push(`t.state = 'needs_reply'`);
    else if (o.filter === 'unread') where.push(CH_UNREAD);
    else if (o.filter === 'done') where.push(`t.state IN ('done', 'ignored')`);
    else if (o.filter === 'planned') where.push(plannedWhere('chat', o.plans));
    else where.push(`t.state <> 'ignored'`);
    if (o.q) {
      vals.push(`%${o.q}%`);
      const n = vals.length;
      where.push(`(COALESCE(c.full_name, pe.full_name, t.counterpart_name, t.title) ILIKE $${n}
                   OR t.counterpart_phone ILIKE $${n} OR a.name ILIKE $${n})`);
    }
  }
  return `
    SELECT 'chat' AS channel, t.id::text AS id, t.owner_user_id::text AS owner_user_id, u.name AS owner_name,
           COALESCE(c.full_name, pe.full_name, t.counterpart_name, t.title) AS name,
           COALESCE(c.title, pe.facets ->> 'title', CASE WHEN t.is_group THEN 'Group chat' END) AS headline,
           COALESCE(a.name, pe.organization) AS company, t.counterpart_email AS email, NULL::text AS subject,
           t.last_snippet AS snippet, t.last_message_at, COALESCE(t.last_from_them, true) AS last_from_them, t.state,
           ${CH_UNREAD} AS unread, t.prospect_id::text AS prospect_id, t.person_id::text AS person_id,
           sl.id::text AS sales_lead_id,
           (SELECT cc.name FROM campaign_enrollments ce JOIN campaigns cc ON cc.id = ce.campaign_id
             WHERE ce.prospect_id = t.prospect_id ORDER BY ce.status = 'active' DESC, ce.entered_node_at DESC LIMIT 1) AS campaign_name,
           t.app, NULL::text AS mailbox, ${planCol('chat', o.plans)},
           ${gkeyCol('chat', 'COALESCE(t.person_id, p.person_id)', 't.prospect_id')}
      FROM chat_threads t
      JOIN users u ON u.id = t.owner_user_id
      LEFT JOIN people pe ON pe.id = t.person_id
      LEFT JOIN prospects p ON p.id = t.prospect_id
      LEFT JOIN contacts c ON c.id = p.contact_id
      LEFT JOIN accounts a ON a.id = p.account_id
      LEFT JOIN sales_leads sl ON sl.prospect_id = t.prospect_id
     WHERE ${where.join(' AND ')}`;
}

let chatsReady = false;
/** Before core migration 100 the chat tables do not exist: the Inbox then simply has no chats. Cached once true. */
async function chatsStored(client: PoolClient): Promise<boolean> {
  if (chatsReady) return true;
  const { rows } = await client.query(`SELECT to_regclass('public.chat_threads') IS NOT NULL AS ok`);
  chatsReady = !!rows[0]?.ok;
  return chatsReady;
}

function iso(v: unknown): string | null {
  return v instanceof Date ? v.toISOString() : (v as string | null) ?? null;
}

let plansReady = false;
/** Before core migration 103 there are no conversation plans: rows carry plan = null, the Planned filter is empty. */
async function plansStored(client: PoolClient): Promise<boolean> {
  if (plansReady) return true;
  const { rows } = await client.query(`SELECT to_regclass('public.conversation_plans') IS NOT NULL AS ok`);
  plansReady = !!rows[0]?.ok;
  return plansReady;
}

type Row = Record<string, unknown> & { channel: InboxChannel; id: string; gkey: string };

function toRef(r: Row): InboxThreadRef {
  return {
    channel: r.channel, id: r.id, app: (r.app as InboxThreadRef['app']) ?? null, state: r.state as InboxState,
    unread: !!r.unread, last_message_at: iso(r.last_message_at), last_from_them: !!r.last_from_them,
    subject: (r.subject as string | null) ?? null, mailbox: (r.mailbox as string | null) ?? null,
    plan: (r.plan as InboxThreadRef['plan']) ?? null,
  };
}

/** One list row from the newest thread of a group plus the others folded in (rows arrive newest first). */
function toItem(rows: Row[]): InboxItem {
  const head = rows[0];
  const threads = rows.map(toRef);
  const states = threads.map((t) => t.state);
  const state: InboxState = states.includes('needs_reply') ? 'needs_reply' : states.includes('waiting') ? 'waiting'
    : states.every((s) => s === 'ignored') ? 'ignored' : 'done';
  const { gkey: _g, ...rest } = head;
  void _g;
  return {
    ...(rest as unknown as InboxItem),
    key: head.gkey,
    channels: [...new Set(threads.map((t) => t.channel))],
    threads,
    last_message_at: iso(head.last_message_at),
    last_from_them: !!head.last_from_them,
    unread: threads.some((t) => t.unread),
    state,
    plan: threads.find((t) => t.plan)?.plan ?? null,
    // the person's ids: the newest thread may be the one without them
    prospect_id: (rows.find((r) => r.prospect_id)?.prospect_id as string | null) ?? null,
    person_id: (rows.find((r) => r.person_id)?.person_id as string | null) ?? null,
    sales_lead_id: (rows.find((r) => r.sales_lead_id)?.sales_lead_id as string | null) ?? null,
    campaign_name: (rows.find((r) => r.campaign_name)?.campaign_name as string | null) ?? null,
    name: (rows.find((r) => r.name)?.name as string | null) ?? null,
    headline: (rows.find((r) => r.headline)?.headline as string | null) ?? null,
    company: (rows.find((r) => r.company)?.company as string | null) ?? null,
    email: (rows.find((r) => r.email)?.email as string | null) ?? null,
  };
}

/** Fold thread rows (newest first) into one item per group key, in order of each group's newest thread. */
function fold(rows: Row[]): InboxItem[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const g = groups.get(r.gkey);
    if (g) g.push(r); else groups.set(r.gkey, [r]);
  }
  return [...groups.values()].map(toItem);
}

export async function listInbox(o: ListOpts): Promise<{ items: InboxItem[]; counts: InboxCounts }> {
  const client = await pool.connect();
  try {
    o = { ...o, plans: await plansStored(client) };
    const vals: unknown[] = [];
    const parts: string[] = [];
    if (o.channel === 'all' || o.channel === 'linkedin') parts.push(linkedinSql(o, vals));
    if (o.channel === 'all' || o.channel === 'email') parts.push(emailSql(o, vals));
    if ((o.channel === 'all' || o.channel === 'chat') && await chatsStored(client)) parts.push(chatSql(o, vals));
    if (!parts.length) return { items: [], counts: await countInbox(client, { ...o, filter: 'all', q: '' }) };
    vals.push(o.limit);
    const { rows } = await client.query<Row>(
      `SELECT * FROM (${parts.join(' UNION ALL ')}) x ORDER BY last_message_at DESC NULLS LAST LIMIT $${vals.length}`, vals);
    const counts = await countInbox(client, { ...o, filter: 'all', q: '' });
    return { items: fold(rows), counts };
  } finally {
    client.release();
  }
}

/** Per channel: threads. Across channels (the rollup row): PEOPLE — a person on two channels counts once. */
async function countInbox(client: PoolClient, o: ListOpts): Promise<InboxCounts> {
  o = { ...o, plans: await plansStored(client) };
  const vals: unknown[] = [];
  const parts = [linkedinSql(o, vals, true), emailSql(o, vals, true)];
  if (await chatsStored(client)) parts.push(chatSql(o, vals, true));
  const { rows } = await client.query(
    `SELECT channel, count(DISTINCT gkey) FILTER (WHERE state = 'needs_reply')::int AS needs_reply,
            count(DISTINCT gkey) FILTER (WHERE unread)::int AS unread,
            count(DISTINCT gkey) FILTER (WHERE plan IS NOT NULL)::int AS planned,
            count(*)::int AS total
       FROM (${parts.join(' UNION ALL ')}) x WHERE state <> 'ignored' GROUP BY ROLLUP (channel)`, vals);
  const by = Object.fromEntries(rows.map((r) => [r.channel ?? 'all', r]));
  return {
    needs_reply: by.all?.needs_reply ?? 0,
    unread: by.all?.unread ?? 0,
    planned: by.all?.planned ?? 0,
    email: by.email?.total ?? 0,
    linkedin: by.linkedin?.total ?? 0,
    chat: by.chat?.total ?? 0,
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

let filesReady = false;
/** Migration 104 (message files) applied? (only a yes is remembered, so applying it needs no restart) */
async function filesStored(client: PoolClient): Promise<boolean> {
  if (filesReady) return true;
  const { rows } = await client.query(`SELECT to_regclass('public.message_files') IS NOT NULL AS ok`);
  filesReady = !!rows[0]?.ok;
  return filesReady;
}

const IMAGE = /^image\/(png|jpe?g|gif|webp|heic|heif)$/i;

/**
 * A stored message's files → what the page draws. Ours as sent point at our own copy (/api/inbox/files/<id>); theirs
 * at the message (/api/inbox/attachment/<channel>/<message>/<n>), fetched from Gmail / Unipile when opened.
 */
function attachmentsOf(channel: InboxChannel, messageId: string, list: unknown): { attachments?: InboxAttachment[] } {
  if (!Array.isArray(list) || !list.length) return {};
  const out: InboxAttachment[] = list.map((a: Record<string, unknown>, i: number) => {
    const name = String(a.name || 'file');
    const mime = a.mime ? String(a.mime) : null;
    const url = a.file_id ? `/api/inbox/files/${a.file_id}` : `/api/inbox/attachment/${channel}/${messageId}/${i}`;
    const image = (!!mime && IMAGE.test(mime)) || (!mime && a.kind === 'img');
    return { name, mime, size: typeof a.size === 'number' ? a.size : null, url, image, ...(a.unavailable ? { unavailable: true } : {}) };
  });
  return { attachments: out };
}

/**
 * Who owns a conversation, when the viewer may see it (the same rule as getThread: their own, or any as an
 * administrator, within the personal-mail rule of the list queries). For the file downloads.
 */
export async function threadAccess(channel: InboxChannel, id: string, viewer: { userId: string; admin: boolean }):
  Promise<{ owner_user_id: string } | null> {
  const client = await pool.connect();
  try {
    if (channel === 'chat' && !(await chatsStored(client))) return null;
    const o: ListOpts = { viewerId: viewer.userId, team: true, channel, filter: 'all', q: '', view: 'all', limit: 1, plans: await plansStored(client) };
    const vals: unknown[] = [];
    const base = channel === 'linkedin' ? linkedinSql(o, vals, true) : channel === 'chat' ? chatSql(o, vals, true) : emailSql(o, vals, true);
    vals.push(id);
    const { rows } = await client.query(`SELECT x.owner_user_id FROM (${base}) x WHERE x.id = $${vals.length}`, vals);
    const head = rows[0];
    if (!head) return null;
    if (head.owner_user_id !== viewer.userId && !viewer.admin) return null;
    return { owner_user_id: head.owner_user_id };
  } finally {
    client.release();
  }
}

/** One conversation, or null when it does not exist or the viewer may not see it. Marks it seen for its owner. */
export async function getThread(channel: InboxChannel, id: string, viewer: { userId: string; admin: boolean }):
  Promise<InboxThread | null> {
  const client = await pool.connect();
  try {
    const o: ListOpts = { viewerId: viewer.userId, team: true, channel, filter: 'all', q: '', view: 'all', limit: 1, plans: await plansStored(client) };
    const vals: unknown[] = [];
    if (channel === 'chat' && !(await chatsStored(client))) return null;
    const base = channel === 'linkedin' ? linkedinSql(o, vals, true) : channel === 'chat' ? chatSql(o, vals, true) : emailSql(o, vals, true);
    vals.push(id);
    const { rows } = await client.query(`SELECT * FROM (${base}) x WHERE x.id = $${vals.length}`, vals);
    const head = rows[0];
    if (!head) return null;
    const mine = head.owner_user_id === viewer.userId;
    if (!mine && !viewer.admin) return null;

    let raw: Array<Omit<InboxMessage, 'channel' | 'app' | 'thread_id'>> = [];
    // the message files (core 104); before 104 an empty list
    const files = (await filesStored(client)) ? 'attachments' : `'[]'::jsonb AS attachments`;
    let profile_url: string | null = null;
    let mailbox: string | null = null;
    let chat: { can_reply: boolean; only_last_message: boolean; open_url: string | null; kind: string } | null = null;
    let unknownSender = false;
    let isGroup = false;
    let emailMeta: { mailbox: string | null; gmail_thread_id: string; origin: string; person_id: string | null; prospect_id: string | null } | null = null;
    if (channel === 'chat') {
      const t = await client.query(
        `SELECT t.can_reply, t.only_last_message, t.open_url, t.is_group, s.kind, s.revoked_at IS NULL AS live
           FROM chat_threads t JOIN messaging_sources s ON s.id = t.source_id WHERE t.id = $1`, [id]);
      const r = t.rows[0];
      isGroup = !!r?.is_group;
      chat = { can_reply: !!(r?.can_reply && r?.live && r?.kind === 'unipile_whatsapp' && !r?.is_group), only_last_message: !!r?.only_last_message,
               open_url: r?.open_url ?? null, kind: r?.kind ?? '' };
      const m = await client.query(
        `SELECT id::text, from_me, sender_name, COALESCE(text, '') AS text, sent_at, truncated, time_is_read_time, ${files} FROM chat_messages
          WHERE thread_id = $1 ORDER BY sent_at NULLS FIRST, created_at LIMIT 500`, [id]);
      raw = m.rows.map((r) => ({ id: r.id, from_me: r.from_me, text: r.truncated ? `${r.text}…` : r.text, sent_at: iso(r.sent_at),
        ...(isGroup && r.from_me === false && r.sender_name ? { sender_name: r.sender_name as string } : {}),
        ...(r.from_me === null ? { sender_unknown: true } : {}), ...(r.time_is_read_time ? { read_time: true } : {}),
        ...attachmentsOf('chat', r.id, r.attachments) }));
      unknownSender = m.rows.some((r) => r.from_me === null || r.time_is_read_time);
    } else if (channel === 'linkedin') {
      const t = await client.query(`SELECT attendee_profile_url FROM linkedin_threads WHERE id = $1`, [id]);
      profile_url = t.rows[0]?.attendee_profile_url ?? null;
      const m = await client.query(
        `SELECT id::text, is_sender AS from_me, COALESCE(text, '') AS text, sent_at, ${files} FROM linkedin_messages
          WHERE thread_id = $1 ORDER BY sent_at NULLS FIRST, created_at LIMIT 500`, [id]);
      raw = m.rows.map((r) => ({ id: r.id, from_me: r.from_me, text: r.text, sent_at: iso(r.sent_at), ...attachmentsOf('linkedin', r.id, r.attachments) }));
    } else {
      const t = await client.query(`SELECT mailbox, gmail_thread_id, origin, person_id, prospect_id FROM email_threads WHERE id = $1`, [id]);
      mailbox = t.rows[0]?.mailbox ?? null;
      emailMeta = t.rows[0] ?? null;
      const m = await client.query(
        `SELECT id::text, from_me, COALESCE(body, '') AS text, sent_at, from_header AS "from", subject, ${files} FROM email_messages
          WHERE thread_id = $1 ORDER BY sent_at NULLS FIRST, created_at LIMIT 500`, [id]);
      raw = m.rows.map((r) => ({ id: r.id, from_me: r.from_me, text: r.text, sent_at: iso(r.sent_at), from: r.from, subject: r.subject,
        ...attachmentsOf('email', r.id, r.attachments) }));
    }
    // Replies typed here that the send gate is holding (quiet hours, a cap): shown as "waiting to be sent".
    const pend = await client.query(
      `SELECT o.id::text, o.message, o.created_at, ${files === 'attachments' ? 'o.attachments' : files} FROM outreach_approvals o
        WHERE o.drafted_by = 'inbox' AND o.status = 'approved' AND o.consumed_at IS NULL
          AND ${channel === 'linkedin' ? 'o.linkedin_thread_id = $1::uuid'
            : channel === 'chat'
              ? `o.channel = 'whatsapp' AND (o.owner_user_id, o.person_id) = (SELECT owner_user_id, person_id FROM chat_threads WHERE id = $1)`
              : `o.email_thread_id = (SELECT gmail_thread_id FROM email_threads WHERE id = $1) AND o.owner_user_id = (SELECT owner_user_id FROM email_threads WHERE id = $1)`}
        ORDER BY o.created_at`, [id]);
    raw = raw.concat(pend.rows.map((r) => ({ id: `pending:${r.id}`, from_me: true, text: r.message, sent_at: iso(r.created_at), pending: true,
      ...attachmentsOf(channel, r.id, r.attachments) })));
    // every message says which thread it came through (the icon on the bubble; the person view merges threads)
    const app = (head.app as InboxMessage['app']) ?? null;
    const messages: InboxMessage[] = raw.map((m) => ({ ...m, channel, app, thread_id: id }));

    let stage: string | null = null;
    if (head.prospect_id) {
      const s = await client.query(`SELECT stage FROM prospects WHERE id = $1`, [head.prospect_id]);
      stage = s.rows[0]?.stage ?? null;
    }
    if (mine) {
      await client.query(`UPDATE ${TABLE[channel]} SET inbox_seen_at = now() WHERE id = $1`, [id]);
    }
    let reply_note: string | null = null;
    if (!mine) reply_note = `Sent from ${head.owner_name || 'a teammate'}'s ${channel === 'linkedin' ? 'LinkedIn' : channel === 'chat' ? 'phone' : 'mailbox'} — only they can reply.`;
    let can_reply = mine;
    let source_note: string | null = null;
    let open_url: string | null = null;
    if (emailMeta) {
      // Open the thread in that mailbox's Gmail (core 102: the person may have several accounts).
      open_url = `https://mail.google.com/mail/u/${encodeURIComponent(emailMeta.mailbox || '0')}/#all/${encodeURIComponent(emailMeta.gmail_thread_id)}`;
      // Anyone in the mailbox can be answered from here (2026-11-06): someone not in the CRM gets a bare person node
      // with the address at send time, so the send gate can check it; nothing else is added.
    }
    if (chat) {
      can_reply = mine && chat.can_reply;
      if (mine && !chat.can_reply) reply_note = isGroup
        ? 'A group chat is read here only. Answer it in WhatsApp.'
        : 'Sending from here works for WhatsApp connected on Profile → Messaging. Draft a reply, copy it and send it in the app.';
      source_note = chat.kind === 'zeami_link'
        ? (chat.only_last_message
          ? 'Read from Zeami Messaging, which keeps only the last message of this chat: the history here builds up from the times we read it (every 10 minutes).'
          : 'Read from Zeami Messaging every 10 minutes.')
        : chat.kind === 'mac_push' ? 'Pushed from your Mac.' : 'Your WhatsApp, read every 10 minutes.';
      if (unknownSender) source_note += ' Read on your Mac, Zeami does not say who wrote a message or when: the time shown is when we read it.';
    }
    const one: InboxThread = {
      ...toItem([head as Row]), unread: mine ? false : !!head.unread, profile_url, mailbox, messages, can_reply, reply_note,
      prospect_stage: stage,
      mine,
      targets: [], default_target: null,
      ...(chat ? { only_last_message: chat.only_last_message, open_url: chat.open_url, source_note } : {}),
      ...(open_url ? { open_url } : {}),
    };
    one.targets = [targetOf(one)];
    one.default_target = threadKey(one);
    return one;
  } finally {
    client.release();
  }
}

/** done / reopen — the conversation's owner or an admin. Returns false when not allowed or not found. */
export async function setThreadState(channel: InboxChannel, id: string, action: 'done' | 'reopen',
  viewer: { userId: string; admin: boolean }): Promise<boolean> {
  const table = TABLE[channel];
  const owner = channel === 'linkedin'
    ? `(SELECT la.owner_user_id FROM linkedin_accounts la WHERE la.id = t.account_id)`
    : 't.owner_user_id';
  const set = action === 'done' ? `'done'` : `CASE WHEN t.last_from_them THEN 'needs_reply' ELSE 'waiting' END`;
  const { rowCount } = await pool.query(
    `UPDATE ${table} t SET state = ${set} WHERE t.id = $1 AND ($2::boolean OR ${owner} = $3)`, [id, viewer.admin, viewer.userId]);
  return (rowCount ?? 0) > 0;
}

/** The reply target one thread offers (the pill above the reply box). */
function targetOf(t: InboxThread): ReplyTarget {
  return {
    channel: t.channel, id: t.id, app: t.app ?? null, label: channelLabel(t), can_reply: t.can_reply,
    copy_only: !t.can_reply && t.channel === 'chat' && !!t.mine, reply_note: t.reply_note,
    last_from_them: t.last_from_them, last_message_at: t.last_message_at, state: t.state, plan: t.plan ?? null,
    mailbox: t.mailbox, subject: t.subject, open_url: t.open_url ?? null, profile_url: t.profile_url, mine: !!t.mine,
  };
}

/** The threads of one group key the viewer may list (their own, or any as an admin), newest first, at most 12 —
 *  each costs a round of queries, and a teammate with twenty email threads is read for the newest ones. */
async function threadsOfKey(client: PoolClient, key: string, viewer: { userId: string; admin: boolean }): Promise<Row[]> {
  const o: ListOpts = { viewerId: viewer.userId, team: true, channel: 'all', filter: 'all', q: '', view: 'all', limit: 50, plans: await plansStored(client) };
  const vals: unknown[] = [];
  const parts = [linkedinSql(o, vals, true), emailSql(o, vals, true)];
  if (await chatsStored(client)) parts.push(chatSql(o, vals, true));
  vals.push(key);
  const { rows } = await client.query<Row>(
    `SELECT * FROM (${parts.join(' UNION ALL ')}) x WHERE x.gkey = $${vals.length} ORDER BY last_message_at DESC NULLS LAST LIMIT 12`, vals);
  return rows.filter((r) => viewer.admin || r.owner_user_id === viewer.userId);
}

/** The group key of one thread (null when it does not exist). */
async function keyOfThread(client: PoolClient, channel: InboxChannel, id: string, viewerId: string): Promise<string | null> {
  // the viewer's own id: the email query compares it to a uuid column (an empty string failed every email thread)
  // and it is what lets the owner find their own personal mail
  const o: ListOpts = { viewerId, team: true, channel, filter: 'all', q: '', view: 'all', limit: 1, plans: false };
  const vals: unknown[] = [];
  if (channel === 'chat' && !(await chatsStored(client))) return null;
  const base = channel === 'linkedin' ? linkedinSql(o, vals, true) : channel === 'chat' ? chatSql(o, vals, true) : emailSql(o, vals, true);
  vals.push(id);
  const { rows } = await client.query<Row>(`SELECT x.gkey FROM (${base}) x WHERE x.id = $${vals.length}`, vals);
  return rows[0]?.gkey ?? null;
}

/**
 * One PERSON's conversation (2026-11-09): every thread of a `person:` / `prospect:` key the viewer may see, merged
 * into one timeline (each message tagged with its channel), with one reply target per thread. The default target is
 * the thread they last wrote in that can be answered from here, else the newest one that can. A `<channel>:<id>` key
 * gives the one thread. Null when nothing is visible.
 */
export async function getPerson(key: string, viewer: { userId: string; admin: boolean }): Promise<InboxThread | null> {
  const k = parseKey(key);
  if (!k || k.kind === 'accepted') return null;
  if (k.kind === 'thread') return getThread(k.channel!, k.id, viewer);
  const client = await pool.connect();
  let rows: Row[];
  try {
    rows = await threadsOfKey(client, key, viewer);
  } finally {
    client.release();
  }
  if (!rows.length) return null;
  const threads: InboxThread[] = [];
  for (const r of rows) {
    const t = await getThread(r.channel, r.id, viewer);   // one client at a time; marks each of your own seen
    if (t) threads.push(t);
  }
  if (!threads.length) return null;
  if (threads.length === 1) return { ...threads[0], key };
  const item = toItem(rows.filter((r) => threads.some((t) => t.id === r.id)));
  const messages = threads.flatMap((t) => t.messages)
    .sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? ''));
  const targets = threads.map(targetOf);
  const usable = targets.filter((t) => t.can_reply || t.copy_only);
  const theirs = usable.filter((t) => t.last_from_them).sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''));
  const def = theirs[0] ?? usable[0] ?? targets[0];
  const head = threads.find((t) => t.id === def.id) ?? threads[0];
  const li = threads.find((t) => t.channel === 'linkedin');
  const em = threads.find((t) => t.channel === 'email');
  return {
    ...head,
    ...item,
    key,
    messages,
    targets,
    default_target: threadKey(def),
    can_reply: targets.some((t) => t.can_reply),
    mine: threads.some((t) => t.mine),
    reply_note: def.reply_note,
    unread: threads.some((t) => t.unread),
    profile_url: li?.profile_url ?? null,
    mailbox: em?.mailbox ?? null,
    open_url: head.open_url ?? em?.open_url ?? null,
    source_note: threads.map((t) => t.source_note).filter(Boolean).join(' ') || null,
    prospect_stage: threads.find((t) => t.prospect_stage)?.prospect_stage ?? null,
  };
}

/** The conversation one thread belongs to: the person's when it is grouped, else the thread alone. */
export async function getConversation(channel: InboxChannel, id: string, viewer: { userId: string; admin: boolean }): Promise<InboxThread | null> {
  const client = await pool.connect();
  let key: string | null;
  try {
    key = await keyOfThread(client, channel, id, viewer.userId);
  } finally {
    client.release();
  }
  if (!key) return null;
  return getPerson(key, viewer);
}

/** done / reopen on every thread of a person the viewer may act on. Returns how many changed. */
export async function setPersonState(key: string, action: 'done' | 'reopen', viewer: { userId: string; admin: boolean }): Promise<number> {
  const k = parseKey(key);
  if (!k || k.kind === 'accepted') return 0;
  if (k.kind === 'thread') return (await setThreadState(k.channel!, k.id, action, viewer)) ? 1 : 0;
  const client = await pool.connect();
  let rows: Row[];
  try {
    rows = await threadsOfKey(client, key, viewer);
  } finally {
    client.release();
  }
  let n = 0;
  for (const r of rows) if (await setThreadState(r.channel, r.id, action, viewer)) n++;
  return n;
}
