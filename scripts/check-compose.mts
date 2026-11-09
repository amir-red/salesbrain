/**
 * Read-only check of the Inbox compose facts (lib/inbox-compose-server.ts) against the database: what the lead's
 * OWNER and Amir could do with one person from their own accounts. Writes nothing.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { composeFacts } from '../lib/inbox-compose-server.ts';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const url = env.split('\n').find((l) => l.startsWith('DATABASE_URL='))!.slice('DATABASE_URL='.length).replace(/^['"]|['"]$/g, '');
const pool = new pg.Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  // usage: node --experimental-strip-types --no-warnings scripts/check-compose.mts "<part of a name>"
  const q = `%${process.argv[2] || 'Bühring'}%`;
  const { rows } = await client.query(`SELECT p.id, c.full_name, p.owner_user_id FROM leads p JOIN contacts c ON c.id = p.contact_id WHERE c.full_name ILIKE $1 ORDER BY p.updated_at DESC LIMIT 1`, [q]);
  if (!rows[0]) { console.log('nobody matches', q); return; }
  const amir = (await client.query(`SELECT id FROM users WHERE email='amir@chipchip.social'`)).rows[0].id;
  const p = rows[0];
  console.log(`viewer = the owner of ${p.full_name}`);
  const a = await composeFacts(client, p.id, p.owner_user_id);
  console.log(JSON.stringify({ open: a?.open, linkedin: a?.linkedin, email: a?.email, person: a?.person, owner: a?.owner }, null, 1));
  console.log('viewer = Amir');
  const b = await composeFacts(client, p.id, amir);
  console.log(JSON.stringify({ open: b?.open, linkedin: b?.linkedin, email: { mode: b?.email.mode, mailbox: b?.email.mailbox, address: b?.email.address }, waiting: b?.waiting.length }, null, 1));
} finally { client.release(); await pool.end(); }
