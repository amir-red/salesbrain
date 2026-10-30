import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { visibleIcp } from '@/lib/icp-server';

/**
 * GET /api/icp/[id]/leads/[leadId] — the heavy part of one row, fetched when it is expanded: the qualification
 * reasons, the research text and the full profile-lookup detail (candidates to pick from, discovered leaders).
 * The list itself (GET /api/icp/[id]/leads) carries only what the table draws.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string; leadId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const icp = await visibleIcp(params.id, session);
  if (!icp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!/^[0-9a-f-]{36}$/i.test(params.leadId)) return NextResponse.json({ error: 'Bad lead id' }, { status: 400 });
  const r = await pool.query(
    `SELECT p.qualification_reason, p.research_summary,
            CASE WHEN p.linkedin_public_id IS NULL AND lk.result IS NOT NULL THEN jsonb_build_object(
              'result', lk.result, 'reason', lk.detail->>'reason',
              'candidates', COALESCE(lk.detail->'candidates', '[]'::jsonb),
              'strong', COALESCE(lk.detail->'strong', '[]'::jsonb),
              'duplicate_of', lk.detail->>'duplicate_of', 'created_at', lk.created_at,
              'rung', lk.detail->>'rung', 'discovered', COALESCE(lk.detail->'discovered', '[]'::jsonb),
              'possible', COALESCE(lk.detail->'possible', '[]'::jsonb),
              'queries', COALESCE(lk.detail->'queries', '[]'::jsonb)) END AS profile_lookup
       FROM leads p
       LEFT JOIN LATERAL (
         SELECT e.result, e.detail, e.created_at FROM prospect_enrichment e
          WHERE e.prospect_id = p.id AND e.kind = 'linkedin'
          ORDER BY e.created_at DESC LIMIT 1) lk ON true
      WHERE p.id = $1 AND p.icp_profile_id = $2`,
    [params.leadId, params.id]);
  if (!r.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(r.rows[0]);
}
