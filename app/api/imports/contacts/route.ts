import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { parseLinkedInConnectedOn, parseLinkedInContactsCsv } from '@/lib/message-parsers';
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

  // Batched, not row-at-a-time. The previous shape ran 2-3 round trips per
  // contact — roughly 35,000 queries for a 13k-row Connections.csv, which is
  // why a full export took minutes and sometimes outlived the request.
  const CHUNK = 500;

  // --- accounts (org-wide) --------------------------------------------------
  const companies = new Map<string, string>();   // normalized -> raw, first spelling wins
  for (const c of contacts) {
    if (!c.company) continue;
    const norm = normalizeCompanyName(c.company);
    if (norm && !companies.has(norm)) companies.set(norm, c.company);
  }
  const accountIdByNorm = new Map<string, string>();
  if (companies.size > 0) {
    const norms = [...companies.keys()];
    const { rows } = await pool.query(
      `SELECT id, LOWER(name) AS lname FROM accounts WHERE LOWER(name) = ANY($1::text[])`,
      [norms]
    );
    for (const r of rows) accountIdByNorm.set(r.lname, r.id);

    const missing = norms.filter((n) => !accountIdByNorm.has(n));
    for (let i = 0; i < missing.length; i += CHUNK) {
      const slice = missing.slice(i, i + CHUNK);
      const { rows: made } = await pool.query(
        `INSERT INTO accounts (name, source)
         SELECT * FROM unnest($1::text[], $2::text[])
         ON CONFLICT DO NOTHING
         RETURNING id, LOWER(name) AS lname`,
        [slice.map((n) => companies.get(n)!), slice.map(() => 'linkedin_csv')]
      );
      for (const r of made) accountIdByNorm.set(r.lname, r.id);
      stats.accounts_created += made.length;
    }
    // A concurrent import may have won the insert; re-read whatever is still missing.
    const stillMissing = norms.filter((n) => !accountIdByNorm.has(n));
    if (stillMissing.length > 0) {
      const { rows } = await pool.query(
        `SELECT id, LOWER(name) AS lname FROM accounts WHERE LOWER(name) = ANY($1::text[])`,
        [stillMissing]
      );
      for (const r of rows) accountIdByNorm.set(r.lname, r.id);
    }
  }

  // --- dedup against what this user already has -----------------------------
  const emails = [...new Set(contacts.map((c) => c.email?.toLowerCase()).filter(Boolean) as string[])];
  const seenEmails = new Set<string>();
  if (emails.length > 0) {
    const { rows } = await pool.query(
      `SELECT LOWER(email) AS e FROM contacts WHERE owner_user_id = $1 AND LOWER(email) = ANY($2::text[])`,
      [session.userId, emails]
    );
    for (const r of rows) seenEmails.add(r.e);
  }
  const { rows: nameRows } = await pool.query(
    `SELECT account_id, LOWER(full_name) AS n FROM contacts
      WHERE owner_user_id = $1 AND account_id IS NOT NULL`,
    [session.userId]
  );
  const seenByAccountName = new Set(nameRows.map((r) => `${r.account_id}\u0000${r.n}`));

  // --- insert -------------------------------------------------------------
  type Row = [string | null, string, string | null, string | null, string | null,
              string | null, string | null, string | null];
  const pending: Row[] = [];
  for (const c of contacts) {
    const norm = normalizeCompanyName(c.company);
    const accountId = norm ? accountIdByNorm.get(norm) ?? null : null;
    const email = c.email?.toLowerCase() ?? null;
    const nameKey = accountId ? `${accountId}\u0000${c.full_name.toLowerCase()}` : null;

    if ((email && seenEmails.has(email)) || (nameKey && seenByAccountName.has(nameKey))) {
      stats.skipped++;
      continue;
    }
    if (email) seenEmails.add(email);
    if (nameKey) seenByAccountName.add(nameKey);

    pending.push([
      accountId, c.full_name, c.first_name, c.last_name, c.email, c.title,
      c.linkedin_url,
      // Kept at last: the connection date used to be parsed and then thrown
      // away, and it is exactly the signal the relationship graph decays on.
      parseLinkedInConnectedOn(c.connected_on),
    ]);
  }

  for (let i = 0; i < pending.length; i += CHUNK) {
    const slice = pending.slice(i, i + CHUNK);
    const col = (n: number) => slice.map((r) => r[n]);
    const { rowCount } = await pool.query(
      `INSERT INTO contacts (account_id, full_name, first_name, last_name, email, title,
                             linkedin_url, connected_on, source, owner_user_id)
       SELECT t.account_id, t.full_name, t.first_name, t.last_name, t.email, t.title,
              t.linkedin_url, t.connected_on, 'linkedin_csv', $9::uuid
         FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[],
                     $6::text[], $7::text[], $8::date[])
              AS t(account_id, full_name, first_name, last_name, email, title,
                   linkedin_url, connected_on)`,
      [col(0), col(1), col(2), col(3), col(4), col(5), col(6), col(7), session.userId]
    );
    stats.contacts_created += rowCount ?? 0;
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

  // Hand the relationship graph to the timer rather than building it inline: a
  // 13k-row import is minutes of work and would blow the request. Queuing is
  // idempotent (one pending run per owner, migration 038).
  let graph: Record<string, unknown> | null = null;
  if (stats.contacts_created > 0) {
    try {
      graph = await kernelCall('crm_agent_request_run', { agent: 'graph_sync' }, session.userId);
    } catch (err) {
      graph = { skipped: err instanceof Error ? err.message : 'graph sync unavailable' };
    }
  }

  return NextResponse.json({ ...stats, qualified, graph });
}
