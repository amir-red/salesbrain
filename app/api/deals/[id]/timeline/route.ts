import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Check if deal exists and whether the caller can see chat history.
  // Visibility for the conversation entries: creator, assigned lead, or admin.
  const { rows: dealRows } = await pool.query(
    'SELECT id, user_id, lead_id FROM deals WHERE id = $1',
    [params.id]
  );
  if (dealRows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const deal = dealRows[0];
  const isOwner = deal.user_id === session.userId
    || deal.lead_id === session.userId
    || session.role === 'admin';

  // Base query: gate changes, board decisions, followups (visible to all)
  let query = `
    SELECT id::text, 'gate_change' as type, created_at as timestamp,
           'Gate G' || from_gate || ' → G' || to_gate as title,
           reason as detail
    FROM gate_events
    WHERE deal_id = $1

    UNION ALL

    SELECT id::text, 'board_decision' as type, created_at as timestamp,
           'Board Review G' || gate as title,
           COALESCE(decision, 'pending') as detail
    FROM board_decisions
    WHERE deal_id = $1

    UNION ALL

    SELECT id::text, 'followup_sent' as type, sent_at as timestamp,
           COALESCE(subject, type || ' followup') as title,
           to_email as detail
    FROM followups
    WHERE deal_id = $1 AND sent = true AND sent_at IS NOT NULL`;

  // Only include conversation entries for the deal owner
  if (isOwner) {
    query += `

    UNION ALL

    SELECT id::text, 'conversation' as type, created_at as timestamp,
           LEFT(content, 120) as title,
           NULL as detail
    FROM conversations
    WHERE deal_id = $1 AND role = 'user'`;
  }

  query += `

    ORDER BY timestamp DESC
    LIMIT 50`;

  const { rows } = await pool.query(query, [params.id]);

  return NextResponse.json(rows);
}
