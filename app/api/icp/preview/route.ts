import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { normalizeCriteria, normalizeWeights, weightsTotal } from '@/lib/icp';

/**
 * Dry-run criteria against the user's existing contacts — the builder's
 * "preview my matches" step. Scoring lives in ONE place (salesbrain-core
 * policy/icp.py), so this goes through the kernel rather than re-implementing
 * the rubric in TypeScript where it would drift.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { criteria?: unknown; limit?: number; sample?: number };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const criteria = normalizeCriteria(body.criteria);
  if (weightsTotal(criteria.weights) !== 100) criteria.weights = normalizeWeights(criteria.weights);

  try {
    const out = await kernelCall('crm_icp_preview', {
      criteria,
      limit: Math.min(Math.max(Number(body.limit) || 10, 1), 50),
      sample: Math.min(Math.max(Number(body.sample) || 1000, 50), 5000),
    }, session.userId);
    return NextResponse.json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'Preview needs the kernel (salesbrain-core) — not reachable from this host.', detail: msg },
      { status: 503 },
    );
  }
}
