/**
 * GET /api/followups/linkedin — who is due a LinkedIn follow-up.
 *
 * Derived from the prospecting pipeline, not from the `followups` table (that
 * one is deal-bound): a person we messaged (P5_SENT), no reply, whose cadence
 * timer (`prospects.next_followup_at`, armed by the kernel on every sent
 * message — agents.followup.spacing_days) exists, plus anyone with a follow-up
 * draft awaiting approval. Replies clear the timer (record_reply), so answered
 * people fall off by themselves.
 *
 * Visibility: admins see every owner, everyone else their own leads.
 * ONE client, sequential queries (Supabase session pooler).
 */
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const own = session.role === 'admin' ? '' : 'AND p.owner_user_id = $1';
  const vals = session.role === 'admin' ? [] : [session.userId];

  const client = await pool.connect();
  try {
    const { rows: policy } = await client.query(`SELECT value FROM policy_rules WHERE key = 'agents.followup'`);
    const cadence = (policy[0]?.value ?? {}) as { spacing_days?: number[]; max_touches?: number; enabled?: boolean };

    const { rows: items } = await client.query(
      `SELECT p.id, p.owner_user_id, p.person_id, p.touch_count, p.last_contacted_at, p.next_followup_at,
              p.linkedin_public_id, c.full_name, c.title, a.name AS company, i.name AS icp_name, u.name AS owner_name,
              (SELECT t.id FROM linkedin_threads t
                 JOIN linkedin_accounts la ON la.id = t.account_id
                WHERE la.owner_user_id = p.owner_user_id AND la.revoked_at IS NULL
                  AND p.person_id IS NOT NULL AND t.person_id = p.person_id
                ORDER BY t.last_message_at DESC NULLS LAST LIMIT 1) AS thread_id,
              (SELECT jsonb_build_object('message', oa.message, 'sent_at', oa.sent_at, 'kind', oa.kind, 'channel', oa.channel)
                 FROM outreach_approvals oa
                WHERE oa.prospect_id = p.id AND oa.status = 'sent' AND oa.kind <> 'connect'
                ORDER BY oa.sent_at DESC LIMIT 1) AS last_sent,
              (SELECT jsonb_build_object('id', oa.id, 'message', oa.message, 'created_at', oa.created_at)
                 FROM outreach_approvals oa
                WHERE oa.prospect_id = p.id AND oa.status = 'pending' AND oa.kind = 'followup'
                ORDER BY oa.created_at DESC LIMIT 1) AS pending
         FROM prospects p
         JOIN contacts c ON c.id = p.contact_id
         LEFT JOIN accounts a ON a.id = p.account_id
         LEFT JOIN icp_profiles i ON i.id = p.icp_profile_id
         JOIN users u ON u.id = p.owner_user_id
        WHERE p.stage = 'P5_SENT' AND p.converted_deal_id IS NULL ${own}
          AND (p.next_followup_at IS NOT NULL
               OR EXISTS (SELECT 1 FROM outreach_approvals oa
                           WHERE oa.prospect_id = p.id AND oa.status = 'pending' AND oa.kind = 'followup'))
        ORDER BY p.next_followup_at ASC NULLS LAST, c.full_name`,
      vals,
    );

    const { rows: sent } = await client.query(
      `SELECT oa.id, oa.message, oa.sent_at, oa.prospect_id, c.full_name, a.name AS company, u.name AS owner_name
         FROM outreach_approvals oa
         JOIN prospects p ON p.id = oa.prospect_id
         JOIN contacts c ON c.id = p.contact_id
         LEFT JOIN accounts a ON a.id = p.account_id
         JOIN users u ON u.id = p.owner_user_id
        WHERE oa.kind = 'followup' AND oa.status = 'sent' AND oa.channel = 'linkedin' ${own}
        ORDER BY oa.sent_at DESC LIMIT 100`,
      vals,
    );

    return NextResponse.json({
      items, sent,
      spacing_days: cadence.spacing_days ?? [4, 7, 10],
      max_touches: cadence.max_touches ?? 3,
      agent_enabled: Boolean(cadence.enabled),
    });
  } finally {
    client.release();
  }
}
