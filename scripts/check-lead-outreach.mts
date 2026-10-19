/**
 * Read-only: run the lead card's outreach facts (lib/sales-lead-outreach.ts) over real leads and
 * print how many land in each mode, with one example each. Writes nothing.
 *   DATABASE_URL=… node --experimental-strip-types --no-warnings scripts/check-lead-outreach.mts
 */
import pg from 'pg';
import { outreachFacts } from '../lib/sales-lead-outreach.ts';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  const admin = (await client.query(`SELECT id FROM users WHERE email = 'amir@chipchip.social'`)).rows[0].id as string;
  const leads = (await client.query(`SELECT id, full_name FROM sales_leads WHERE status NOT IN ('archived','converted') ORDER BY created_at DESC`)).rows;
  const byMode: Record<string, { n: number; example: string; detail: string }> = {};
  for (const l of leads) {
    const f = await outreachFacts(client, l.id, admin, true);
    if (!f) continue;
    const m = (byMode[f.mode] ??= { n: 0, example: '', detail: '' });
    m.n += 1;
    if (!m.example || (f.thread.length > 1 && f.mode === 'thread')) {
      m.example = l.full_name;
      m.detail = `sender=${f.sender?.name ?? '—'} thread=${f.thread.length} pending=${f.pending.map((p) => p.kind).join('/') || 0} why=${f.why ?? ''}`;
    }
  }
  console.table(byMode);
} finally {
  client.release();
  await pool.end();
}
