import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const status = req.nextUrl.searchParams.get('status');
  const prospectId = req.nextUrl.searchParams.get('prospect_id');

  const filters: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (status) {
    filters.push(`om.status = $${i++}`);
    values.push(status);
  }
  if (prospectId) {
    filters.push(`om.prospect_id = $${i++}`);
    values.push(prospectId);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT om.*, p.stage as prospect_stage,
            a.name as company_name, c.full_name as contact_name
     FROM outreach_messages om
     JOIN prospects p ON p.id = om.prospect_id
     LEFT JOIN accounts a ON a.id = p.account_id
     LEFT JOIN contacts c ON c.id = p.contact_id
     ${where}
     ORDER BY om.created_at DESC LIMIT 200`,
    values
  );
  return NextResponse.json(rows);
}
