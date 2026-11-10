// Deletes Hannes's agent-sourced leads (contacts.source in linkedin_search, company_discovery)
// and their contacts. Dry run by default; pass --apply to delete. Writes a JSON backup first.
// Run from salesbrain/:  export $(grep '^DATABASE_URL=' .env.local | sed "s/'//g") && node scripts/delete-hannes-agent-leads.mjs --apply
import fs from 'node:fs';
import pg from 'pg';
const apply = process.argv.includes('--apply');
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const c = await p.connect();
const q = async (s) => (await c.query(s)).rows;
const T = `select l.id from leads l join contacts c on c.id=l.contact_id join users u on u.id=c.owner_user_id
  where u.email ilike 'hannes@%' and c.source in ('linkedin_search','company_discovery')`;
const CT = `select c.id from contacts c join users u on u.id=c.owner_user_id
  where u.email ilike 'hannes@%' and c.source in ('linkedin_search','company_discovery')`;
try {
  await c.query('begin');
  const [b] = await q(`select (select count(*) from research_briefs where contact_id in (${CT}))::int rb,
    (select count(*) from suppression_list where contact_id in (${CT}))::int sl,
    (select count(*) from leads where contact_id in (${CT}) and id not in (${T}))::int other_leads,
    (select count(*) from leads where id in (${T}) and card_id is not null)::int cards,
    (select count(*) from leads where id in (${T}) and converted_deal_id is not null)::int deals`);
  console.log('blockers', b);
  if (b.rb || b.sl || b.other_leads || b.cards || b.deals) throw new Error('unexpected dependents, refusing');
  const bk = {
    taken_at: new Date().toISOString(), scope: 'hannes linkedin_search+company_discovery',
    leads: await q(`select * from leads where id in (${T})`),
    contacts: await q(`select * from contacts where id in (${CT})`),
    prospect_enrichment: await q(`select * from prospect_enrichment where prospect_id in (${T})`),
    trust_scores: await q(`select * from trust_scores where prospect_id in (${T})`),
    cohort_scores: await q(`select * from cohort_scores where prospect_id in (${T})`),
    imported_messages: await q(`select * from imported_messages where contact_id in (${CT})`),
  };
  const counts = Object.fromEntries(Object.entries(bk).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]));
  console.log('would delete', counts);
  if (!apply) { await c.query('rollback'); console.log('dry run, nothing changed (pass --apply)'); process.exit(0); }
  const dir = `${process.env.HOME}/.cache/salesbrain/backups`;
  fs.mkdirSync(dir, { recursive: true });
  const f = `${dir}/hannes-agent-leads-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.json`;
  fs.writeFileSync(f, JSON.stringify(bk));
  console.log('backup', f);
  const d1 = await c.query(`delete from leads where id in (${T})`);
  const d2 = await c.query(`delete from contacts where id in (${CT})`);
  const pf = await c.query(`delete from person_funnel where prospect_id is not null and prospect_id not in (select id from leads)`);
  const [left] = await q(`select count(*)::int n from contacts c join users u on u.id=c.owner_user_id where u.email ilike 'hannes@%'`);
  console.log({ leads_deleted: d1.rowCount, contacts_deleted: d2.rowCount, person_funnel_rows_removed: pf.rowCount, hannes_contacts_left: left.n });
  await c.query('commit');
} catch (e) { await c.query('rollback'); console.error('ROLLED BACK:', e.message); process.exit(1); }
finally { c.release(); await p.end(); }
