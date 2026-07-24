import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

/**
 * Deal activity timeline — a read-model over BOTH the legacy tables and the
 * relationship graph, so work done through the Hermes/Telegram agent (which
 * writes the graph + audit log, never the legacy `conversations` table) is
 * visible here alongside web-chat history.
 *
 * Sources:
 *  - gate_events, board_decisions, followups        (legacy, all viewers)
 *  - conversations (web chat)                        (owner/lead/admin only)
 *  - agent_audit_log mutations for this deal         (owner/lead/admin only)
 *  - person_facts + interactions for the linked      (all viewers — graph)
 *    relationship person
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows: dealRows } = await pool.query(
    'SELECT id, user_id, lead_id, relationship_person_id FROM deals WHERE id = $1 AND deleted_at IS NULL',
    [params.id]
  );
  if (dealRows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const deal = dealRows[0];
  const isOwner = deal.user_id === session.userId
    || deal.lead_id === session.userId
    || session.role === 'admin';
  const personId = deal.relationship_person_id as string | null;

  // Legacy deal-scoped events (visible to all viewers).
  const parts: string[] = [`
    SELECT id::text, 'gate_change' as type, created_at as timestamp,
           'Gate G' || from_gate || ' → G' || to_gate as title, reason as detail, NULL as actor
    FROM gate_events WHERE deal_id = $1
    UNION ALL
    SELECT id::text, 'board_decision' as type, created_at as timestamp,
           'Board Review G' || gate as title, COALESCE(decision, 'pending') as detail, NULL as actor
    FROM board_decisions WHERE deal_id = $1
    UNION ALL
    SELECT id::text, 'followup_sent' as type, sent_at as timestamp,
           COALESCE(subject, type || ' followup') as title, to_email as detail, NULL as actor
    FROM followups WHERE deal_id = $1 AND sent = true AND sent_at IS NOT NULL`];

  // Agent actions (create/note/assess/advance/link…) — the trail of work done
  // through the agent on this deal. Mutations only; reads are filtered out.
  // Owner/lead/admin, same as chat history.
  if (isOwner) {
    parts.push(`
    SELECT a.id::text, 'agent_action' as type, a.created_at as timestamp,
           a.command as title, NULL as detail, u.name as actor
    FROM agent_audit_log a
    LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE a.input->>'deal_id' = $1 AND a.status = 'success'
      AND a.command IN ('create_deal','update_deal','record_note','assess_deal',
                        'schedule_followup','mark_deal_lost','link_deal_person',
                        'request_board_review','board_vote_resolved')`);

    parts.push(`
    SELECT id::text, 'conversation' as type, created_at as timestamp,
           LEFT(content, 120) as title, NULL as detail, NULL as actor
    FROM conversations WHERE deal_id = $1 AND role = 'user'`);
  }

  // Relationship-graph activity tied to the linked contact (all viewers).
  const graphParams: (string | null)[] = [params.id];
  if (personId) {
    graphParams.push(personId);
    parts.push(`
    SELECT id::text, 'fact' as type, learned_at as timestamp,
           fact as title, source as detail, NULL as actor
    FROM person_facts WHERE person_id = $2 AND superseded_at IS NULL`);
    parts.push(`
    SELECT id::text, 'interaction' as type, occurred_at as timestamp,
           summary as title, channel as detail, NULL as actor
    FROM interactions WHERE person_id = $2`);
  }

  const { rows } = await pool.query(
    parts.join('\n    UNION ALL\n') + '\n    ORDER BY timestamp DESC LIMIT 60',
    graphParams
  );

  return NextResponse.json(rows);
}
