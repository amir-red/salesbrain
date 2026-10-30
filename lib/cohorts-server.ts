import pool from '@/lib/db';

let stored = false;
let checkedAt = 0;

/** True once migration 090 (cohort_scores) is applied; cached a minute so polled routes don't re-ask. */
export async function cohortsStored(): Promise<boolean> {
  if (stored) return true;
  if (Date.now() - checkedAt < 60_000) return stored;
  try {
    const { rows } = await pool.query("SELECT to_regclass('public.cohort_scores') IS NOT NULL AS ok");
    stored = !!rows[0]?.ok;
  } catch { stored = false; }
  checkedAt = Date.now();
  return stored;
}
