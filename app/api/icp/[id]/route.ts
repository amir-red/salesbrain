import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { buildSalesNavFilters, normalizeCriteria, normalizeWeights, weightsTotal } from '@/lib/icp';
import { IcpBodySchema, auditBestEffort, guardEditable, visibleIcp } from '@/lib/icp-server';

/** Any teammate may read a list (with its owner and whether they may change it); changes are owner or admin. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const row = await visibleIcp(params.id, session);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM prospects WHERE icp_profile_id = $1`, [params.id]);
  return NextResponse.json({ ...row, prospects: rows[0].n, criteria: normalizeCriteria(row.criteria) });
}

/** Full replace of the editable fields (the builder always sends the whole form). */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const guard = await guardEditable(params.id, session);
  if (guard.denied) return guard.denied;
  const owner = guard.icp.owner_user_id;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = IcpBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  const { name, product, description, objective, first_message_template } = parsed.data;
  const criteria = normalizeCriteria(parsed.data.criteria);
  if (weightsTotal(criteria.weights) !== 100) criteria.weights = normalizeWeights(criteria.weights);
  const { filters, search_keywords } = buildSalesNavFilters(criteria);

  // A rename must not collide with another list of the same owner.
  const clash = await pool.query(
    `SELECT id FROM icp_profiles WHERE owner_user_id = $1 AND lower(name) = lower($2) AND id <> $3`,
    [owner, name, params.id],
  );
  if (clash.rows.length) {
    return NextResponse.json({ error: `${owner === session.userId ? 'You already have' : `${guard.icp.owner_name} already has`} an ICP named "${name}"` }, { status: 409 });
  }

  const { rows } = await pool.query(
    `UPDATE icp_profiles SET name = $3, product = $4, description = $5, objective = $9, search_keywords = $6,
       filters = $7, criteria = $8, first_message_template = $10, is_active = true, updated_at = now()
     WHERE id = $1 AND owner_user_id = $2 RETURNING *`,
    [params.id, owner, name, product ?? null, description ?? null, search_keywords || null,
     JSON.stringify(filters), JSON.stringify(criteria), objective ?? null, first_message_template || null],
  );
  await auditBestEffort(session.userId, 'icp_define', { name, icp_id: params.id, via: 'builder', ...(owner !== session.userId ? { owner } : {}) });
  // Editing criteria must reach the people already on the list, not only the
  // next page the finder fetches. Best-effort: the kernel may be unreachable
  // locally, and a save must not fail because a rescore did.
  let rescore: Record<string, unknown> | null = null;
  try { rescore = await kernelCall('crm_icp_rescore', { icp_id: params.id }, owner); } catch { rescore = null; }
  return NextResponse.json({ ...rows[0], criteria: normalizeCriteria(rows[0].criteria), rescore });
}

/** Soft delete — mirrors the kernel's icp_archive. Prospects keep their provenance link. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const guard = await guardEditable(params.id, session);
  if (guard.denied) return guard.denied;
  const { rows } = await pool.query(
    `UPDATE icp_profiles SET is_active = false, updated_at = now()
     WHERE id = $1 RETURNING id, name`,
    [params.id],
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await auditBestEffort(session.userId, 'icp_archive', { icp_id: params.id, via: 'builder' });
  return NextResponse.json({ archived: true, ...rows[0] });
}
