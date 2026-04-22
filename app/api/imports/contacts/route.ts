import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { parseLinkedInContactsCsv } from '@/lib/message-parsers';
import { normalizeCompanyName } from '@/lib/prospecting';

const Schema = z.object({
  source: z.enum(['linkedin_csv', 'generic_csv']),
  text: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const contacts = parsed.data.source === 'linkedin_csv'
    ? parseLinkedInContactsCsv(parsed.data.text)
    : [];

  const stats = { accounts_created: 0, contacts_created: 0, skipped: 0 };

  for (const c of contacts) {
    // Account dedup
    let accountId: string | null = null;
    if (c.company) {
      const normalized = normalizeCompanyName(c.company);
      const { rows } = await pool.query(`SELECT id FROM accounts WHERE LOWER(name) = $1 LIMIT 1`, [normalized]);
      if (rows[0]) {
        accountId = rows[0].id;
      } else {
        const { rows: newRows } = await pool.query(
          `INSERT INTO accounts (name, source) VALUES ($1, 'linkedin_csv') RETURNING id`,
          [c.company]
        );
        accountId = newRows[0].id;
        stats.accounts_created++;
      }
    }

    // Contact dedup SCOPED TO CURRENT USER — contacts are private per user.
    let dup: { rows: Array<{ id: string }> } = { rows: [] };
    if (c.email) {
      dup = await pool.query(
        `SELECT id FROM contacts WHERE LOWER(email) = LOWER($1) AND owner_user_id = $2 LIMIT 1`,
        [c.email, session.userId]
      );
    } else if (accountId) {
      dup = await pool.query(
        `SELECT id FROM contacts WHERE account_id = $1 AND LOWER(full_name) = LOWER($2) AND owner_user_id = $3 LIMIT 1`,
        [accountId, c.full_name, session.userId]
      );
    }
    if (dup.rows.length > 0) { stats.skipped++; continue; }

    await pool.query(
      `INSERT INTO contacts (account_id, full_name, first_name, last_name, email, title, linkedin_url, source, owner_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'linkedin_csv', $8)`,
      [accountId, c.full_name, c.first_name, c.last_name, c.email, c.title, c.linkedin_url, session.userId]
    );
    stats.contacts_created++;
  }

  return NextResponse.json(stats);
}
