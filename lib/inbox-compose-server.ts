/**
 * "Write message" from a person page lands in the Inbox (2026-11-09): what the VIEWER can do with this person from
 * their own accounts. Server only, one checked-out client, sequential queries.
 *
 * - a conversation of the viewer's with this person already exists → the Inbox opens it (`open`)
 * - LinkedIn: the viewer owns the lead and is 1st degree → a first message can go out (the kernel's rule); connected
 *   but not the owner → say so; not connected → a connection request can be filed for the owner; no profile / no account
 * - email: the person's address + the viewer's default mailbox → an email can go out from that mailbox
 */
import type { PoolClient } from 'pg';

/** The profile slugs behind a lead (its URL, its slug, the card's URL), lower-cased — the same reading as
 *  lib/sales-lead-links.ts::slugsOf (kept local so scripts/check-compose.mts loads this file with plain node). */
function slugsOf(...vals: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const raw of vals) {
    const v = (raw || '').trim().split('?')[0].split('#')[0].replace(/\/+$/, '');
    if (!v) continue;
    const slug = (v.includes('/in/') ? v.split('/in/').pop()! : v).replace(/^\/+|\/+$/g, '').toLowerCase();
    if (slug) out.add(slug);
  }
  return [...out];
}

export type LinkedInMode = 'thread' | 'first_message' | 'connected_not_owner' | 'request_pending' | 'not_connected' | 'no_profile' | 'no_account';
export type EmailMode = 'thread' | 'ok' | 'no_address' | 'no_mailbox';

export interface ComposeFacts {
  prospect_id: string; person_id: string | null;
  person: { name: string | null; title: string | null; company: string | null; picture_url: string | null; linkedin_url: string | null; email: string | null; location: string | null };
  owner: { user_id: string | null; name: string | null; is_viewer: boolean };
  /** an existing conversation of the viewer's with this person: the Inbox opens it instead of composing */
  open: string | null;
  linkedin: { mode: LinkedInMode; why: string | null; thread_key: string | null; account: string | null };
  email: { mode: EmailMode; why: string | null; address: string | null; mailbox: string | null; mailboxes: string[]; thread_key: string | null };
  waiting: { id: string; kind: string; channel: string; status: string; message: string | null }[];
}

export async function composeFacts(client: PoolClient, prospectId: string, viewerId: string): Promise<ComposeFacts | null> {
  const { rows } = await client.query(
    `SELECT p.id, p.person_id, p.owner_user_id, u.name AS owner_name, p.linkedin_public_id, p.linkedin_member_id, p.network_degree,
            c.full_name, c.title, c.email, c.linkedin_url, a.name AS company, a.hq_location,
            pp.facets ->> 'picture_url' AS picture_url, pp.facets ->> 'city' AS city, pp.primary_email,
            p.linkedin_url AS card_linkedin_url
       FROM leads p LEFT JOIN contacts c ON c.id = p.contact_id LEFT JOIN accounts a ON a.id = p.account_id
       LEFT JOIN users u ON u.id = p.owner_user_id LEFT JOIN people pp ON pp.id = p.person_id
      WHERE p.id = $1`, [prospectId]);
  const r = rows[0];
  if (!r) return null;
  const personId: string | null = r.person_id ? String(r.person_id) : null;
  const member = ((r.linkedin_member_id as string | null) || '').trim();
  const slugs = slugsOf(r.linkedin_public_id, r.linkedin_url, r.card_linkedin_url);
  const email = ((r.email as string | null) || (r.primary_email as string | null) || '').trim() || null;
  const isOwner = String(r.owner_user_id || '') === viewerId;

  // the viewer's own LinkedIn account and tie
  const acc = (await client.query(
    `SELECT id, display_name FROM linkedin_accounts WHERE owner_user_id = $1 AND revoked_at IS NULL
      ORDER BY connected_at DESC NULLS LAST LIMIT 1`, [viewerId])).rows[0];
  let liThread: { id: string } | null = null;
  let tie: 'connected' | 'pending' | null = null;
  if (acc) {
    liThread = (await client.query(
      `SELECT t.id FROM linkedin_threads t JOIN linkedin_accounts la ON la.id = t.account_id
        WHERE la.owner_user_id = $1 AND la.revoked_at IS NULL AND NOT t.is_company
          AND (($2::uuid IS NOT NULL AND t.person_id = $2::uuid) OR ($3::text <> '' AND t.attendee_provider_id = $3)
               OR (cardinality($4::text[]) > 0 AND lower(t.attendee_public_identifier) = ANY($4::text[])))
        ORDER BY t.last_message_at DESC NULLS LAST LIMIT 1`, [viewerId, personId, member, slugs])).rows[0] ?? null;
    if (slugs.length || member) {
      const t = (await client.query(
        `SELECT 'connected' AS status FROM linkedin_relations lr JOIN linkedin_accounts la ON la.id = lr.account_id
          WHERE la.owner_user_id = $1 AND la.revoked_at IS NULL AND lr.removed_at IS NULL
            AND (($2::text <> '' AND lr.provider_id = $2) OR lower(lr.public_identifier) = ANY($3::text[]))
         UNION ALL
         SELECT CASE WHEN li.status = 'accepted' THEN 'connected' ELSE 'pending' END
           FROM linkedin_invitations li JOIN linkedin_accounts la ON la.id = li.account_id
          WHERE la.owner_user_id = $1 AND la.revoked_at IS NULL AND li.status IN ('accepted', 'pending')
            AND (($2::text <> '' AND li.provider_id = $2) OR lower(li.public_identifier) = ANY($3::text[]))`,
        [viewerId, member, slugs])).rows;
      if (t.some((x) => x.status === 'connected') || (isOwner && String(r.network_degree || '') === '1')) tie = 'connected';
      else if (t.some((x) => x.status === 'pending')) tie = 'pending';
    } else if (isOwner && String(r.network_degree || '') === '1') tie = 'connected';
  }

  // the viewer's email threads / chats with this person
  const emThread = (await client.query(
    `SELECT id FROM email_threads WHERE owner_user_id = $1
       AND (($2::uuid IS NOT NULL AND person_id = $2::uuid) OR prospect_id = $3::uuid
            OR ($4::text IS NOT NULL AND lower(counterpart_email) = lower($4)))
     ORDER BY last_message_at DESC NULLS LAST LIMIT 1`, [viewerId, personId, prospectId, email])).rows[0] ?? null;
  const chat = personId && (await client.query(`SELECT to_regclass('public.chat_threads') IS NOT NULL AS ok`)).rows[0]?.ok
    ? (await client.query(`SELECT id FROM chat_threads WHERE owner_user_id = $1 AND person_id = $2 ORDER BY last_message_at DESC NULLS LAST LIMIT 1`,
        [viewerId, personId])).rows[0] ?? null
    : null;
  const mailboxes = (await client.query(
    `SELECT address, is_default FROM email_senders WHERE user_id = $1 AND revoked_at IS NULL ORDER BY is_default DESC, connected_at`,
    [viewerId])).rows as { address: string; is_default: boolean }[];
  const waiting = (await client.query(
    `SELECT id, kind, channel, status, left(message, 160) AS message FROM outreach_approvals
      WHERE prospect_id = $1 AND owner_user_id = $2 AND status IN ('pending', 'approved') ORDER BY created_at DESC LIMIT 5`,
    [prospectId, viewerId])).rows;

  const hasProfile = !!(slugs.length || member);
  let li: ComposeFacts['linkedin'];
  if (liThread) li = { mode: 'thread', why: null, thread_key: `linkedin:${liThread.id}`, account: acc?.display_name ?? null };
  else if (!hasProfile) li = { mode: 'no_profile', why: 'We do not know their LinkedIn profile yet.', thread_key: null, account: null };
  else if (!acc) li = { mode: 'no_account', why: 'You have no LinkedIn connected — connect one on Profile → LinkedIn.', thread_key: null, account: null };
  else if (tie === 'connected' && isOwner) li = { mode: 'first_message', why: null, thread_key: null, account: acc.display_name };
  else if (tie === 'connected') li = { mode: 'connected_not_owner', why: `You are connected, but ${r.owner_name || 'a teammate'} holds this lead — the first message goes from their account, or take the lead over on its list.`, thread_key: null, account: acc.display_name };
  else if (tie === 'pending') li = { mode: 'request_pending', why: 'Your connection request is out — the first message unlocks when they accept.', thread_key: null, account: acc.display_name };
  else li = { mode: 'not_connected', why: 'Not connected on LinkedIn yet — a message can only go to a connection.', thread_key: null, account: acc.display_name };

  let em: ComposeFacts['email'];
  const def = mailboxes.find((m) => m.is_default) ?? mailboxes[0];
  if (emThread) em = { mode: 'thread', why: null, address: email, mailbox: def?.address ?? null, mailboxes: mailboxes.map((m) => m.address), thread_key: `email:${emThread.id}` };
  else if (!email) em = { mode: 'no_address', why: 'No email address on file — enrich the profile first.', address: null, mailbox: null, mailboxes: mailboxes.map((m) => m.address), thread_key: null };
  else if (!def) em = { mode: 'no_mailbox', why: 'No Gmail connected for sending — connect one on Profile → Google.', address: email, mailbox: null, mailboxes: [], thread_key: null };
  else em = { mode: 'ok', why: null, address: email, mailbox: def.address, mailboxes: mailboxes.map((m) => m.address), thread_key: null };

  const open = liThread ? `linkedin:${liThread.id}` : emThread ? `email:${emThread.id}` : chat ? `chat:${chat.id}` : null;
  return {
    prospect_id: prospectId, person_id: personId,
    person: { name: r.full_name, title: r.title, company: r.company === 'Unknown' ? null : r.company, picture_url: r.picture_url,
              linkedin_url: r.linkedin_url || r.card_linkedin_url || (slugs[0] ? `https://www.linkedin.com/in/${slugs[0]}` : null),
              email, location: r.city || r.hq_location },
    owner: { user_id: r.owner_user_id ? String(r.owner_user_id) : null, name: r.owner_name, is_viewer: isOwner },
    open, linkedin: li, email: em, waiting,
  };
}
