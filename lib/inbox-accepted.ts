import pool from '@/lib/db';

/**
 * The Inbox's "Accepted" tab (2026-11-06): everyone who accepted one of our LinkedIn connection requests in the last
 * 30 days — the same news as the Telegram "🤝 X accepted your connection request" notice, with what to do next:
 *   card     — a first-message draft waits for the owner (the acceptance loop filed it, §5.ah.4): send / edit / skip
 *   to_draft — a lead with no draft yet: draft one here
 *   messaged — a conversation exists: open it in the LinkedIn tab
 *   no_lead  — not a lead (a request sent by hand on LinkedIn): profile link only
 * Server-only (pg). Visibility: your own account; an admin may ask for the whole team (read-only for others).
 */
export type AcceptedStatus = 'card' | 'to_draft' | 'messaged' | 'no_lead';

export interface AcceptedItem {
  id: string;                      // linkedin_invitations.id
  owner_user_id: string;
  owner_name: string | null;
  mine: boolean;
  prospect_id: string | null;
  card_id: string | null;          // the /sales-leads card, when there is one
  name: string | null;
  headline: string | null;
  company: string | null;
  profile_url: string | null;
  accepted_at: string | null;
  sent_at: string | null;
  list_name: string | null;
  template: string | null;         // the list's first-message template
  approval_id: string | null;      // the waiting first-message card
  approval_message: string | null;
  draft_original: string | null;
  thread_id: string | null;        // the LinkedIn conversation, once there is one
  status: AcceptedStatus;
}

const SQL = `
SELECT i.id::text, i.owner_user_id::text, u.name AS owner_name, i.prospect_id::text, i.public_identifier,
       COALESCE(NULLIF(c.full_name, ''), NULLIF(i.full_name, ''), NULLIF(r.full_name, ''), t.attendee_name, i.public_identifier) AS name,
       COALESCE(NULLIF(r.headline, ''), NULLIF(t.attendee_headline, ''), c.title) AS headline,
       a.name AS company, i.accepted_at, i.sent_at, l.card_id::text, ip.name AS list_name, ip.first_message_template AS template,
       ap.id::text AS approval_id, ap.message AS approval_message, ap.draft_original,
       t.id::text AS thread_id, t.has_messages
  FROM linkedin_invitations i
  JOIN linkedin_accounts la ON la.id = i.account_id AND la.revoked_at IS NULL
  JOIN users u ON u.id = i.owner_user_id
  LEFT JOIN leads l ON l.id = i.prospect_id
  LEFT JOIN contacts c ON c.id = l.contact_id
  LEFT JOIN accounts a ON a.id = l.account_id
  LEFT JOIN icp_profiles ip ON ip.id = l.icp_profile_id
  LEFT JOIN linkedin_relations r ON r.account_id = i.account_id AND r.provider_id = i.provider_id
  LEFT JOIN LATERAL (
    SELECT th.id, th.attendee_name, th.attendee_headline,
           EXISTS (SELECT 1 FROM linkedin_messages m WHERE m.thread_id = th.id) AS has_messages
      FROM linkedin_threads th
     WHERE th.account_id = i.account_id
       AND (th.attendee_provider_id = i.provider_id
            OR (i.public_identifier IS NOT NULL AND lower(th.attendee_public_identifier) = lower(i.public_identifier))
            OR (l.person_id IS NOT NULL AND th.person_id = l.person_id))
     ORDER BY th.last_message_at DESC NULLS LAST LIMIT 1) t ON true
  LEFT JOIN LATERAL (
    SELECT o.id, o.message, o.draft_original FROM outreach_approvals o
     WHERE i.prospect_id IS NOT NULL AND o.prospect_id = i.prospect_id AND o.owner_user_id = i.owner_user_id
       AND o.channel = 'linkedin' AND o.kind = 'outreach' AND o.status = 'pending' AND o.linkedin_thread_id IS NULL
       AND o.expires_at > now()
     ORDER BY o.created_at DESC LIMIT 1) ap ON true
 WHERE i.status = 'accepted' AND i.accepted_at > now() - interval '30 days'`;

function iso(v: unknown): string | null {
  return v instanceof Date ? v.toISOString() : v ? String(v) : null;
}

function toItem(r: Record<string, unknown>, viewerId: string): AcceptedItem {
  const slug = r.public_identifier ? String(r.public_identifier) : null;
  const status: AcceptedStatus = r.thread_id && r.has_messages ? 'messaged'
    : r.approval_id ? 'card' : r.prospect_id ? 'to_draft' : 'no_lead';
  return {
    id: String(r.id), owner_user_id: String(r.owner_user_id), owner_name: (r.owner_name as string) ?? null,
    mine: r.owner_user_id === viewerId, prospect_id: (r.prospect_id as string) ?? null, card_id: (r.card_id as string) ?? null,
    name: (r.name as string) ?? null, headline: (r.headline as string) ?? null, company: (r.company as string) ?? null,
    profile_url: slug ? `https://www.linkedin.com/in/${encodeURIComponent(slug)}` : null,
    accepted_at: iso(r.accepted_at), sent_at: iso(r.sent_at), list_name: (r.list_name as string) ?? null,
    template: (r.template as string) ?? null, approval_id: (r.approval_id as string) ?? null,
    approval_message: (r.approval_message as string) ?? null, draft_original: (r.draft_original as string) ?? null,
    thread_id: (r.thread_id as string) ?? null, status,
  };
}

/** Accepted requests, newest first, with the count of people still waiting for a first message. */
export async function listAccepted(viewer: { userId: string; admin: boolean }, team: boolean, q = ''):
  Promise<{ items: AcceptedItem[]; waiting: number }> {
  const vals: unknown[] = [];
  let where = '';
  if (!(team && viewer.admin)) { vals.push(viewer.userId); where += ` AND i.owner_user_id = $${vals.length}`; }
  const { rows } = await pool.query(`${SQL}${where} ORDER BY i.accepted_at DESC LIMIT 300`, vals);
  let items = rows.map((r) => toItem(r, viewer.userId));
  const waiting = items.filter((x) => x.mine && (x.status === 'card' || x.status === 'to_draft')).length;
  const needle = q.trim().toLowerCase();
  if (needle) items = items.filter((x) => [x.name, x.headline, x.company, x.list_name].some((v) => (v || '').toLowerCase().includes(needle)));
  return { items, waiting };
}

/** One accepted request, if the viewer may see it. */
export async function getAccepted(id: string, viewer: { userId: string; admin: boolean }): Promise<AcceptedItem | null> {
  const { rows } = await pool.query(`${SQL} AND i.id = $1`, [id]);
  const it = rows[0] ? toItem(rows[0], viewer.userId) : null;
  if (!it || (!it.mine && !viewer.admin)) return null;
  return it;
}

/** The list's template with the person's words in it (same placeholders as the acceptance loop). */
export function renderTemplate(template: string, it: AcceptedItem): string {
  const full = (it.name || '').trim();
  return template.replaceAll('{first_name}', full.split(/\s+/)[0] ?? '').replaceAll('{full_name}', full)
    .replaceAll('{company}', it.company ?? '').trim();
}
