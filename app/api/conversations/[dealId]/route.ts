import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify access: admins see all; regular users see deals they created
  // (user_id) OR are the assigned project lead on (lead_id). Same rule as
  // /api/deals so the chat history follows the same visibility as the deal.
  const isAdmin = session.role === 'admin';
  const { rows: dealRows } = await pool.query(
    isAdmin
      ? 'SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL'
      : 'SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL AND (user_id = $2 OR lead_id = $2)',
    isAdmin ? [params.dealId] : [params.dealId, session.userId]
  );
  if (dealRows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Relationship OS: when the Hermes runtime owns this user+deal's chat,
  // hydrate from the Hermes session transcript instead of the legacy table.
  const { hermesRuntimeEnabled, fetchHermesHistory } = await import('@/lib/hermes-proxy');
  if (hermesRuntimeEnabled()) {
    const { rows: sess } = await pool.query(
      `SELECT hermes_session_id FROM agent_sessions
       WHERE user_id = $1 AND deal_id = $2 AND channel = 'web'
       ORDER BY created_at DESC LIMIT 1`,
      [session.userId, params.dealId]
    );
    if (sess[0]) {
      return NextResponse.json(await fetchHermesHistory(sess[0].hermes_session_id));
    }
    return NextResponse.json([]); // no Hermes session yet — fresh chat
  }

  const { rows } = await pool.query(
    `SELECT role, content, tool_name, created_at
     FROM conversations
     WHERE deal_id = $1 AND role IN ('user', 'assistant')
     ORDER BY created_at ASC
     LIMIT 100`,
    [params.dealId]
  );

  return NextResponse.json(rows);
}
