import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = session.role === 'admin';

  // Prospects are private per user (owner_user_id). Admins see all.
  const ownerFilter = isAdmin ? '' : 'AND (p.owner_user_id = $2 OR p.owner_user_id IS NULL)';
  const ownerValues = isAdmin ? [params.id] : [params.id, session.userId];

  const { rows } = await pool.query(
    `SELECT p.*, a.name as company_name, a.domain, a.industry, a.company_size, a.hq_location, a.website,
            c.full_name, c.email, c.title, c.seniority, c.persona_type, c.phone, c.linkedin_url,
            u.name as owner_name
     FROM prospects p
     LEFT JOIN accounts a ON a.id = p.account_id
     LEFT JOIN contacts c ON c.id = p.contact_id
     LEFT JOIN users u ON u.id = p.owner_user_id
     WHERE p.id = $1 ${ownerFilter}`,
    ownerValues
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [briefs, scores, messages, events] = await Promise.all([
    pool.query(`SELECT * FROM research_briefs WHERE prospect_id = $1 ORDER BY created_at DESC`, [params.id]),
    pool.query(`SELECT * FROM qualification_scores WHERE prospect_id = $1 ORDER BY created_at DESC`, [params.id]),
    pool.query(`SELECT * FROM outreach_messages WHERE prospect_id = $1 ORDER BY created_at ASC`, [params.id]),
    pool.query(`SELECT * FROM prospect_events WHERE prospect_id = $1 ORDER BY created_at DESC LIMIT 50`, [params.id]),
  ]);

  return NextResponse.json({
    prospect: rows[0],
    briefs: briefs.rows,
    scores: scores.rows,
    messages: messages.rows,
    events: events.rows,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const ALLOWED = new Set(['owner_user_id', 'campaign_id', 'next_action_at', 'archived_reason', 'research_summary']);
  const entries = Object.entries(body).filter(([k]) => ALLOWED.has(k));
  if (entries.length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });

  const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
  const values = entries.map(([, v]) => v);
  const { rows } = await pool.query(
    `UPDATE prospects SET ${sets} WHERE id = $1 RETURNING *`,
    [params.id, ...values]
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}
