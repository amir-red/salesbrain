import pool from '@/lib/db';

let stored = false;
let checkedAt = 0;

/** True once migration 095 (trust_scores) is applied; cached a minute so polled routes don't re-ask. */
export async function trustStored(): Promise<boolean> {
  if (stored) return true;
  if (Date.now() - checkedAt < 60_000) return stored;
  try {
    const { rows } = await pool.query("SELECT to_regclass('public.trust_scores') IS NOT NULL AS ok");
    stored = !!rows[0]?.ok;
  } catch { stored = false; }
  checkedAt = Date.now();
  return stored;
}

/** The columns a list / queue row selects from `trust_scores ts` (LEFT JOIN trust_scores ts ON ts.prospect_id = p.id). */
export const TRUST_COLS = `ts.total AS trust_total,
       jsonb_build_object('authority', ts.authority, 'trust', ts.trust, 'fit', ts.fit, 'openness', ts.openness) AS trust_parts,
       ts.why AS trust_why, ts.trust_via, ts.trust_kind, ts.value_to_us, ts.multiplier, ts.held,
       (ts.held <> 0 OR EXISTS (SELECT 1 FROM score_feedback sf WHERE sf.prospect_id = p.id)) AS has_feedback`;
export const TRUST_NULL_COLS = `NULL::smallint AS trust_total, NULL::jsonb AS trust_parts, NULL::text AS trust_why,
       NULL::text AS trust_via, NULL::text AS trust_kind, NULL::text AS value_to_us, NULL::int AS multiplier,
       NULL::smallint AS held, false AS has_feedback`;
