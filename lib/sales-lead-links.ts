/**
 * Who on the team is linked to a sales lead on LinkedIn — server only (pg).
 *
 * A port of salesbrain-core commands/sales_leads.py::linkedin_links (the card reads with direct SQL; change both).
 * One lead, many accounts: the lead's OWNER may have no connection, or no LinkedIn account at all, while a teammate is
 * connected. Matched on the profile slug or the member id, from the lead's own URL and the prospect behind it.
 */
import type { PoolClient } from 'pg';
import type { LinkedInLink } from '@/lib/sales-leads';

export function slugsOf(...vals: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const raw of vals) {
    const v = (raw || '').trim().split('?')[0].split('#')[0].replace(/\/+$/, '');
    if (!v) continue;
    const slug = (v.includes('/in/') ? v.split('/in/').pop()! : v).replace(/^\/+|\/+$/g, '').toLowerCase();
    if (slug) out.add(slug);
  }
  return [...out];
}

export async function linkedinLinks(client: PoolClient, leadId: string): Promise<LinkedInLink[]> {
  const { rows: lead } = await client.query(
    `SELECT l.linkedin_url, p.linkedin_public_id, p.linkedin_member_id
       FROM sales_leads l LEFT JOIN prospects p ON p.id::text = l.raw_payload->>'prospect_id'
      WHERE l.id = $1`, [leadId]);
  if (!lead[0]) return [];
  const slugs = slugsOf(lead[0].linkedin_public_id, lead[0].linkedin_url);
  const member = ((lead[0].linkedin_member_id as string | null) || '').trim();
  if (!slugs.length && !member) return [];
  const { rows } = await client.query(
    `SELECT la.owner_user_id, u.name AS owner, la.display_name AS account, 'connected' AS status, lr.detected_at AS since
       FROM linkedin_relations lr
       JOIN linkedin_accounts la ON la.id = lr.account_id AND la.revoked_at IS NULL
       JOIN users u ON u.id = la.owner_user_id
      WHERE lr.provider_id = ANY($1::text[]) OR lower(lr.public_identifier) = ANY($2::text[])
     UNION ALL
     SELECT la.owner_user_id, u.name, la.display_name,
            CASE WHEN li.status = 'accepted' THEN 'connected' ELSE 'pending' END, COALESCE(li.accepted_at, li.sent_at)
       FROM linkedin_invitations li
       JOIN linkedin_accounts la ON la.id = li.account_id AND la.revoked_at IS NULL
       JOIN users u ON u.id = la.owner_user_id
      WHERE li.status IN ('accepted', 'pending')
        AND (li.provider_id = ANY($1::text[]) OR lower(li.public_identifier) = ANY($2::text[]))`,
    [member ? [member] : [], slugs]);
  const best = new Map<string, LinkedInLink>();
  for (const r of rows) {                         // one line per person: connected beats pending
    const key = String(r.owner_user_id);
    const cur = best.get(key);
    if (!cur || (cur.status === 'pending' && r.status === 'connected')) {
      best.set(key, { owner_user_id: key, owner: r.owner, account: r.account, status: r.status,
                      since: r.since ? new Date(r.since).toISOString().slice(0, 10) : null });
    }
  }
  return [...best.values()].sort((a, b) => Number(a.status !== 'connected') - Number(b.status !== 'connected') || (a.owner || '').localeCompare(b.owner || ''));
}
