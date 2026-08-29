import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

/** Activity feed for one ICP — every agent tick that touched it, newest first. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const own = await pool.query(`SELECT id FROM icp_profiles WHERE id = $1 AND owner_user_id = $2`, [params.id, session.userId]);
  if (!own.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit')) || 40, 1), 200);
  const { rows } = await pool.query(
    `SELECT r.id, r.agent, r.trigger, r.source, r.status, r.started_at, r.finished_at,
            r.analyzed, r.matched, r.created, r.researched, r.detail, r.error, u.name AS owner_name
     FROM agent_runs r LEFT JOIN users u ON u.id = r.owner_user_id
     WHERE r.icp_profile_id = $1 ORDER BY r.started_at DESC LIMIT $2`,
    [params.id, limit],
  );
  return NextResponse.json(rows);
}
