import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { buildSalesNavFilters, normalizeCriteria, normalizeWeights, weightsTotal } from '@/lib/icp';
import { IcpBodySchema, auditBestEffort } from '@/lib/icp-server';

/**
 * ICP profiles — list + upsert.
 *
 * Data-only rows (no gate logic, no sends), so the app writes them directly
 * like /api/prospects does, with the same upsert semantics as the kernel's
 * icp_define (ON CONFLICT (owner, lower(name))). The builder is the authority
 * on `criteria`, so unlike the agent tool a save REPLACES criteria rather than
 * merging. `filters` and `search_keywords` are derived from criteria here so
 * the sourcing ask can't drift from the scoring rule.
 */

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const all = req.nextUrl.searchParams.get('all') === '1';
  const { rows } = await pool.query(
    `SELECT i.*, (SELECT count(*)::int FROM prospects p WHERE p.icp_profile_id = i.id) AS prospects
     FROM icp_profiles i
     WHERE i.owner_user_id = $1 ${all ? '' : 'AND i.is_active'}
     ORDER BY i.updated_at DESC`,
    [session.userId],
  );
  return NextResponse.json(rows.map((r) => ({ ...r, criteria: normalizeCriteria(r.criteria) })));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = IcpBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  const { name, product, description } = parsed.data;
  const criteria = normalizeCriteria(parsed.data.criteria);
  if (weightsTotal(criteria.weights) !== 100) criteria.weights = normalizeWeights(criteria.weights);
  const { filters, search_keywords } = buildSalesNavFilters(criteria);

  const { rows } = await pool.query(
    `INSERT INTO icp_profiles (owner_user_id, name, product, description, search_keywords, filters, criteria)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (owner_user_id, lower(name)) DO UPDATE SET
       product = EXCLUDED.product, description = EXCLUDED.description,
       search_keywords = EXCLUDED.search_keywords, filters = EXCLUDED.filters,
       criteria = EXCLUDED.criteria, is_active = true, updated_at = now()
     RETURNING *`,
    [session.userId, name, product ?? null, description ?? null, search_keywords || null,
     JSON.stringify(filters), JSON.stringify(criteria)],
  );
  await auditBestEffort(session.userId, 'icp_define', { name, icp_id: rows[0].id, via: 'builder' });
  return NextResponse.json({ ...rows[0], criteria: normalizeCriteria(rows[0].criteria) });
}
