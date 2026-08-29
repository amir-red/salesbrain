import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

/** Global activity feed: ?agent=leads_finder&limit=50. Users see their own runs; admins all. */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const agent = req.nextUrl.searchParams.get('agent');
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit')) || 50, 1), 200);
  const values: unknown[] = [limit];
  const where: string[] = [`r.status <> 'requested'`];
  if (session.role !== 'admin') { values.push(session.userId); where.push(`(r.owner_user_id = $${values.length} OR r.owner_user_id IS NULL)`); }
  if (agent) { values.push(agent); where.push(`r.agent = $${values.length}`); }
  const { rows } = await pool.query(
    `SELECT r.id, r.agent, r.trigger, r.source, r.status, r.started_at, r.finished_at,
            r.analyzed, r.matched, r.created, r.researched, r.detail, r.error,
            r.icp_profile_id, i.name AS icp_name, u.name AS owner_name
     FROM agent_runs r
     LEFT JOIN icp_profiles i ON i.id = r.icp_profile_id
     LEFT JOIN users u ON u.id = r.owner_user_id
     WHERE ${where.join(' AND ')} ORDER BY r.started_at DESC LIMIT $1`, values);
  return NextResponse.json(rows);
}
