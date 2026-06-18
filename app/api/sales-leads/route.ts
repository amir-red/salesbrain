/**
 * Internal (authenticated) API for browsing demo-form submissions.
 *
 *   GET /api/sales-leads?status=new|contacted|converted|archived|all
 *
 * Org-wide visibility (any signed-in user sees the inbox). Default filter is
 * `new` so the page opens to "what needs triage."
 */
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get('status') || 'new';

  const validStatuses = new Set(['new', 'contacted', 'converted', 'archived', 'all']);
  if (!validStatuses.has(status)) {
    return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
  }

  const filterClause = status === 'all' ? '' : 'WHERE l.status = $1';
  const params = status === 'all' ? [] : [status];

  const { rows } = await pool.query(
    `SELECT l.id, l.full_name, l.company, l.email, l.description, l.source,
            l.status, l.created_at, l.converted_at, l.converted_deal_id,
            l.preferred_demo_date, l.preferred_demo_time, l.preferred_demo_timezone,
            d.name AS converted_deal_name, d.gate AS converted_deal_gate
     FROM sales_leads l
     LEFT JOIN deals d ON d.id = l.converted_deal_id
     ${filterClause}
     ORDER BY l.created_at DESC
     LIMIT 200`,
    params,
  );

  return NextResponse.json({ leads: rows });
}
