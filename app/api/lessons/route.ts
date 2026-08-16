/**
 * GET /api/lessons
 *   Query params:
 *     deal_type=sales|grant|all          (default: all)
 *     root_cause=<RootCause>|all         (default: all)
 *     limit=<1..200> (default: 100)
 *
 * Org-wide visibility — any signed-in user sees all lessons. The whole
 * point is to share learning across the team; private lessons would
 * defeat the purpose.
 */
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { ROOT_CAUSES } from '@/lib/lessons';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const dealType = url.searchParams.get('deal_type') || 'all';
  const rootCause = url.searchParams.get('root_cause') || 'all';
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || '100')));

  const validDealTypes = new Set(['sales', 'grant', 'ai_credit', 'all']);
  if (!validDealTypes.has(dealType)) {
    return NextResponse.json({ error: `Invalid deal_type: ${dealType}` }, { status: 400 });
  }
  if (rootCause !== 'all' && !ROOT_CAUSES.includes(rootCause as typeof ROOT_CAUSES[number])) {
    return NextResponse.json({ error: `Invalid root_cause: ${rootCause}` }, { status: 400 });
  }

  // Build the WHERE clause dynamically so untouched filters don't
  // pollute the index plan.
  const where: string[] = [];
  const params: unknown[] = [];
  if (dealType !== 'all') {
    params.push(dealType);
    where.push(`l.deal_type = $${params.length}`);
  }
  if (rootCause !== 'all') {
    params.push(rootCause);
    where.push(`l.root_cause = $${params.length}`);
  }
  params.push(limit);
  const limitIdx = params.length;

  const { rows } = await pool.query(
    `SELECT l.id, l.deal_id, l.deal_type, l.gate_lost_at, l.value, l.currency,
            l.company, l.reason, l.root_cause, l.competitor, l.lesson,
            l.created_by, l.created_at,
            u.name AS created_by_name,
            d.name AS deal_name, d.status AS deal_status
     FROM lessons_learned l
     LEFT JOIN users u ON u.id = l.created_by
     LEFT JOIN deals d ON d.id = l.deal_id
     ${where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY l.created_at DESC
     LIMIT $${limitIdx}`,
    params,
  );

  return NextResponse.json({ lessons: rows });
}
