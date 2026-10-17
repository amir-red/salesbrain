/**
 * GET /api/sales-leads/:id/lookup — the newest "find their LinkedIn profile" attempt for this lead's prospect:
 * the candidates a person must choose from (stage `needs_pick`), or why nothing was found. The same shape the ICP
 * leads table uses (`ProfileLookup`), read on demand so the list route stays light.
 *   → { prospect_id, profile_lookup: ProfileLookup | null, has_profile }
 */
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT l.prospect_id::text AS prospect_id, p.linkedin_public_id,
              CASE WHEN lk.result IS NOT NULL THEN jsonb_build_object(
                'result', lk.result, 'reason', lk.detail->>'reason',
                'candidates', COALESCE(lk.detail->'candidates', '[]'::jsonb),
                'strong', COALESCE(lk.detail->'strong', '[]'::jsonb),
                'possible', COALESCE(lk.detail->'possible', '[]'::jsonb),
                'duplicate_of', lk.detail->>'duplicate_of', 'created_at', lk.created_at,
                'rung', lk.detail->>'rung', 'queries', COALESCE(lk.detail->'queries', '[]'::jsonb)) END AS profile_lookup
         FROM sales_leads l
         LEFT JOIN prospects p ON p.id = l.prospect_id
         LEFT JOIN LATERAL (SELECT e.result, e.detail, e.created_at FROM prospect_enrichment e
                             WHERE e.prospect_id = p.id AND e.kind = 'linkedin'
                             ORDER BY e.created_at DESC LIMIT 1) lk ON true
        WHERE l.id = $1`, [id]);
    if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({
      prospect_id: rows[0].prospect_id, has_profile: !!rows[0].linkedin_public_id,
      profile_lookup: rows[0].linkedin_public_id ? null : rows[0].profile_lookup,
    });
  } finally {
    client.release();
  }
}
