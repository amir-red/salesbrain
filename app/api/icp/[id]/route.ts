import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { buildSalesNavFilters, normalizeCriteria, normalizeWeights, weightsTotal } from '@/lib/icp';
import { IcpBodySchema, auditBestEffort } from '@/lib/icp-server';

async function owned(id: string, userId: string) {
  const { rows } = await pool.query(
    `SELECT i.*, (SELECT count(*)::int FROM prospects p WHERE p.icp_profile_id = i.id) AS prospects
     FROM icp_profiles i WHERE i.id = $1 AND i.owner_user_id = $2`,
    [id, userId],
  );
  return rows[0] ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const row = await owned(params.id, session.userId);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ...row, criteria: normalizeCriteria(row.criteria) });
}

/** Full replace of the editable fields (the builder always sends the whole form). */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await owned(params.id, session.userId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

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

  // A rename must not collide with another of the user's profiles.
  const clash = await pool.query(
    `SELECT id FROM icp_profiles WHERE owner_user_id = $1 AND lower(name) = lower($2) AND id <> $3`,
    [session.userId, name, params.id],
  );
  if (clash.rows.length) {
    return NextResponse.json({ error: `You already have an ICP named "${name}"` }, { status: 409 });
  }

  const { rows } = await pool.query(
    `UPDATE icp_profiles SET name = $3, product = $4, description = $5, search_keywords = $6,
       filters = $7, criteria = $8, is_active = true, updated_at = now()
     WHERE id = $1 AND owner_user_id = $2 RETURNING *`,
    [params.id, session.userId, name, product ?? null, description ?? null, search_keywords || null,
     JSON.stringify(filters), JSON.stringify(criteria)],
  );
  await auditBestEffort(session.userId, 'icp_define', { name, icp_id: params.id, via: 'builder' });
  return NextResponse.json({ ...rows[0], criteria: normalizeCriteria(rows[0].criteria) });
}

/** Soft delete — mirrors the kernel's icp_archive. Prospects keep their provenance link. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { rows } = await pool.query(
    `UPDATE icp_profiles SET is_active = false, updated_at = now()
     WHERE id = $1 AND owner_user_id = $2 RETURNING id, name`,
    [params.id, session.userId],
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await auditBestEffort(session.userId, 'icp_archive', { icp_id: params.id, via: 'builder' });
  return NextResponse.json({ archived: true, ...rows[0] });
}
