import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { exec_create_or_import_prospect } from '@/lib/prospect-executors';

const CreateProspectSchema = z.object({
  company_name: z.string().min(1),
  domain: z.string().optional(),
  full_name: z.string().min(1),
  email: z.string().email().optional(),
  title: z.string().optional(),
  source_type: z.string().optional(),
  source_detail: z.string().optional(),
  campaign_id: z.string().uuid().optional(),
  notes: z.string().optional(),
});

/**
 * GET /api/prospects — one page of the prospects list for /prospecting.
 * Query: stage, mine=true, campaign_id, reply_status, q (name / company / email / title), limit (≤500, default 100), offset.
 * Answers { rows, total, counts, limit, offset }: `total` matches every filter, `counts` is per stage over every
 * filter EXCEPT stage (so the stage chips stay right while one is selected). Visibility: regular users see their own
 * prospects and unowned ones; admins see all. One checked-out client, queries in sequence (pooler rule).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const stage = params.get('stage');
  const ownerOnly = params.get('mine') === 'true';
  const campaignId = params.get('campaign_id');
  const replyStatus = params.get('reply_status');
  const q = (params.get('q') || '').trim().slice(0, 100);
  const limit = Math.min(Math.max(Math.floor(Number(params.get('limit'))) || 100, 1), 500);
  const offset = Math.max(Math.floor(Number(params.get('offset'))) || 0, 0);
  const isAdmin = session.role === 'admin';

  const filters: string[] = [];
  const values: unknown[] = [];
  const add = (sql: (n: number) => string, v: unknown) => { values.push(v); filters.push(sql(values.length)); };

  if (ownerOnly) add((n) => `p.owner_user_id = $${n}`, session.userId);
  else if (!isAdmin) add((n) => `(p.owner_user_id = $${n} OR p.owner_user_id IS NULL)`, session.userId);
  if (campaignId) add((n) => `p.campaign_id = $${n}`, campaignId);
  if (replyStatus) add((n) => `p.reply_status = $${n}`, replyStatus);
  if (q) add((n) => `(c.full_name ILIKE $${n} OR a.name ILIKE $${n} OR c.email ILIKE $${n} OR c.title ILIKE $${n})`,
             `%${q.replace(/[%_\\]/g, '\\$&')}%`);

  const from = `FROM prospects p
     LEFT JOIN accounts a ON a.id = p.account_id
     LEFT JOIN contacts c ON c.id = p.contact_id`;
  const baseWhere = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const listFilters = [...filters];
  const listValues = [...values];
  if (stage) { listValues.push(stage); listFilters.push(`p.stage = $${listValues.length}`); }
  const listWhere = listFilters.length ? `WHERE ${listFilters.join(' AND ')}` : '';

  const client = await pool.connect();
  try {
    const counts: Record<string, number> = {};
    const c = await client.query<{ stage: string; n: number }>(
      `SELECT p.stage, count(*)::int AS n ${from} ${baseWhere} GROUP BY p.stage`, values);
    for (const r of c.rows) counts[r.stage] = r.n;
    const total = stage ? (counts[stage] ?? 0) : Object.values(counts).reduce((s, n) => s + n, 0);

    const { rows } = await client.query(
      `SELECT p.*, a.name as company_name, a.domain, a.industry, a.company_size,
              c.full_name, c.email, c.title, c.seniority,
              u.name as owner_name
       ${from}
       LEFT JOIN users u ON u.id = p.owner_user_id
       ${listWhere}
       ORDER BY p.updated_at DESC, p.id
       LIMIT ${limit} OFFSET ${offset}`,
      listValues
    );
    return NextResponse.json({ rows, total, counts, limit, offset });
  } finally {
    client.release();
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = CreateProspectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const result = await exec_create_or_import_prospect(parsed.data, { userId: session.userId });
  // Ensure prospect owner is the current user (contact owner is set via the executor).
  if (result.prospect_id) {
    await pool.query(`UPDATE prospects SET owner_user_id = $1 WHERE id = $2 AND owner_user_id IS NULL`, [session.userId, result.prospect_id]);
  }
  return NextResponse.json(result, { status: 201 });
}
