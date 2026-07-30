import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { parseLinkedInContactsCsv } from '@/lib/message-parsers';
import { normalizeCompanyName } from '@/lib/prospecting';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB cap

const ACCEPTED_MIME = new Set([
  'text/csv',
  'application/csv',
  'text/plain',                 // some browsers send CSVs as text/plain
  'application/vnd.ms-excel',   // legacy CSV mime in Safari
  'application/octet-stream',   // fallback for unknown senders
]);

/**
 * POST multipart/form-data with:
 *   - file: a Connections.csv (LinkedIn export)
 *   - source: 'linkedin_csv' | 'generic_csv' (optional, defaults to linkedin_csv)
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file');
  const source = (formData.get('source') as string) || 'linkedin_csv';

  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file must be a File' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'File is empty' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File exceeds 10 MB limit (got ${(file.size / 1024 / 1024).toFixed(1)} MB)` }, { status: 400 });
  }

  // Be lenient about mime — accept anything that looks like csv by extension OR mime
  const isCsvByExt = file.name.toLowerCase().endsWith('.csv');
  const isCsvByMime = ACCEPTED_MIME.has(file.type);
  if (!isCsvByExt && !isCsvByMime) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type || 'unknown'}. Upload a .csv file (LinkedIn Connections export).` },
      { status: 400 }
    );
  }

  const text = await file.text();
  if (!text.trim()) {
    return NextResponse.json({ error: 'File contents are empty' }, { status: 400 });
  }

  const contacts = source === 'linkedin_csv' ? parseLinkedInContactsCsv(text) : [];
  if (contacts.length === 0) {
    return NextResponse.json(
      {
        error:
          'No contacts found in CSV. If you exported a ZIP from LinkedIn, extract the Connections.csv file and upload that. Make sure the file has the standard header row (First Name, Last Name, URL, Email Address, Company, Position).',
        accounts_created: 0,
        contacts_created: 0,
        skipped: 0,
      },
      { status: 400 }
    );
  }

  const stats = { accounts_created: 0, contacts_created: 0, skipped: 0 };

  for (const c of contacts) {
    // Account dedup (org-wide)
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

  // Imported contacts used to stop here — they became rows and nothing else,
  // never entering the pipeline (12,932 contacts had produced zero prospects).
  // Score them against the user's active ICP and promote the fits; anything
  // below the policy floor stays a contact rather than flooding the queue.
  // Best-effort: a scoring hiccup must not fail an otherwise good import.
  let qualified: Record<string, unknown> | null = null;
  if (stats.contacts_created > 0) {
    try {
      qualified = await kernelCall('crm_prospect_auto_qualify', {}, session.userId);
    } catch (err) {
      qualified = { skipped: err instanceof Error ? err.message : 'auto-qualify unavailable' };
    }
  }

  return NextResponse.json({ ...stats, qualified });
}
