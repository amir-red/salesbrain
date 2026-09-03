/**
 * POST /api/icp/optimize — the builder's "Suggest ICPs" action.
 *
 * Session-authed. Takes whatever the user has entered (website / description /
 * product / current partial criteria) plus an optional primary objective, and
 * returns 2–4 candidate ICPs each scored on the five objectives. Nothing is
 * persisted — the user picks a candidate, which fills the form, then Saves.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { optimizeIcp } from '@/lib/icp-optimize';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: {
    website?: string; description?: string; product?: string;
    objective?: string; criteria?: Record<string, unknown>; filters?: Record<string, unknown>;
    n_candidates?: number;
  } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const out = await optimizeIcp({
    website: body.website, description: body.description, product: body.product,
    objective: body.objective, criteria: body.criteria, filters: body.filters,
    n_candidates: body.n_candidates,
  });
  if ((out as { error?: string }).error) {
    return NextResponse.json({ error: (out as { error: string }).error }, { status: 422 });
  }
  return NextResponse.json(out);
}
