/**
 * The facts behind the lead card's LinkedIn outreach panel (app/api/sales-leads/[id]/outreach):
 * who sends, what is possible now, the conversation so far, what already waits for a decision.
 * Server only. Imports are type-only so a plain `node --experimental-strip-types` script can
 * exercise the SQL against a database (scripts/check-lead-outreach.mts).
 */
import type { PoolClient } from 'pg';
import type { OutreachMode, OutreachState } from './sales-leads';

export type OutreachFacts = OutreachState & {
  prospect_id: string | null; person_id: string | null; thread_id: string | null;
  template: string | null; product: string | null; research: string | null;
  full_name: string; title: string | null; company: string | null; dossier: Record<string, unknown> | null;
};

export async function outreachFacts(client: PoolClient, leadId: string, viewerId: string, viewerIsAdmin: boolean): Promise<OutreachFacts | null> {
  const { rows } = await client.query(
    `SELECT l.full_name, l.title, l.company, l.dossier, l.prospect_id::text AS prospect_id,
            p.owner_user_id::text AS owner_id, u.name AS owner_name, p.person_id::text AS person_id,
            p.linkedin_public_id, p.linkedin_member_id, p.network_degree, p.research_summary,
            i.first_message_template AS template, i.criteria->>'product' AS product,
            la.id AS account_id
       FROM sales_leads l
       LEFT JOIN prospects p ON p.id = l.prospect_id
       LEFT JOIN users u ON u.id = p.owner_user_id
       LEFT JOIN icp_profiles i ON i.id = p.icp_profile_id
       LEFT JOIN LATERAL (SELECT id FROM linkedin_accounts a WHERE a.owner_user_id = p.owner_user_id
                            AND a.revoked_at IS NULL ORDER BY a.connected_at DESC NULLS LAST LIMIT 1) la ON true
      WHERE l.id = $1`, [leadId]);
  const r = rows[0];
  if (!r) return null;
  const base = {
    full_name: r.full_name, title: r.title, company: r.company === 'Unknown' ? null : r.company, dossier: r.dossier,
    prospect_id: r.prospect_id, person_id: r.person_id, template: r.template, product: r.product, research: r.research_summary,
    sender: r.owner_id ? { user_id: r.owner_id, name: r.owner_name as string | null } : null,
  };
  const empty = { thread_id: null, thread: [], pending: [], can_act: false };
  if (!r.prospect_id) return { ...base, ...empty, mode: 'no_prospect', why: 'No prospect behind this lead yet — find their LinkedIn profile first.' };

  // The conversation on the sender's account: by person, else by member id.
  const t = r.account_id ? (await client.query(
    `SELECT t.id FROM linkedin_threads t
      WHERE t.account_id = $1 AND (($2::uuid IS NOT NULL AND t.person_id = $2::uuid)
                                OR ($3::text IS NOT NULL AND t.attendee_provider_id = $3))
      ORDER BY t.last_message_at DESC NULLS LAST LIMIT 1`, [r.account_id, r.person_id, r.linkedin_member_id])).rows[0] : null;
  const thread = t ? (await client.query(
    `SELECT is_sender AS ours, text, sent_at FROM linkedin_messages WHERE thread_id = $1
      ORDER BY sent_at DESC NULLS LAST LIMIT 6`, [t.id])).rows.reverse() : [];
  const inv = r.account_id ? (await client.query(
    `SELECT status FROM linkedin_invitations WHERE account_id = $1 AND prospect_id = $2
      ORDER BY sent_at DESC NULLS LAST LIMIT 1`, [r.account_id, r.prospect_id])).rows[0] : null;
  const pending = (await client.query(
    `SELECT id, kind, status, message, created_at FROM outreach_approvals
      WHERE prospect_id = $1 AND status IN ('pending', 'approved') AND kind IN ('connect', 'outreach', 'followup')
      ORDER BY created_at DESC`, [r.prospect_id])).rows;

  const canAct = viewerIsAdmin || r.owner_id === viewerId;
  let mode: OutreachMode;
  let why: string | null = null;
  if (!r.linkedin_public_id && !r.linkedin_member_id) { mode = 'no_profile'; why = 'We do not know their LinkedIn profile yet.'; }
  else if (!r.account_id) { mode = 'no_sender'; why = `${r.owner_name ?? 'The owner'} has no LinkedIn connected — nothing can go out from their account.`; }
  else if (t) mode = 'thread';
  else if (r.network_degree === '1' || inv?.status === 'accepted') mode = 'first_message';
  else if (inv?.status === 'pending') mode = 'request_pending';
  else mode = 'connect';
  if (!canAct && !why) why = `Requests and messages go out from ${r.owner_name ?? 'the owner'}'s LinkedIn — ${r.owner_name ?? 'they'} or an admin files them.`;
  return { ...base, mode, why, thread_id: t?.id ?? null, thread, pending, can_act: canAct };
}
