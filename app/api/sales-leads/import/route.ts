import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { guessField, type ImportResult, type ImportRow } from '@/lib/lead-import';
import { TEAM_USERS_SQL } from '@/lib/sales-leads-sql';

/**
 * GET  /api/sales-leads/import → { users }   the back / front office pickers, for pages that open the dialog on their own
 * POST /api/sales-leads/import
 *   multipart (file = .csv / .xlsx / .xls, or text = rows pasted from a sheet) → { headers, rows, mapping }
 *     read the rows, guess the columns; writes nothing
 *   JSON { rows: ImportRow[], list_name?, met_at?, priority?, responsible?, front?, icp_id?, dry_run } → ImportSummary
 * The JSON form goes to the kernel (crm_sales_leads_import) 100 rows at a time — dedupe, roles, track record and the
 * prospect behind every created lead live there; `icp_id` puts the new prospects on that list. 2,000 rows at most.
 */
const MAX_ROWS = 2000;
const CHUNK = 100;
const MAX_BYTES = 10 * 1024 * 1024;

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { rows: users } = await pool.query(TEAM_USERS_SQL);
  return NextResponse.json({ users });
}

/** CSV and pasted text are decoded as UTF-8 first: handed to SheetJS as bytes they come out as Latin-1 ("JÃ¶rg"). */
function readTable(data: Buffer | string, isText: boolean): string[][] {
  const wb = isText
    ? XLSX.read(String(data).replace(/^\uFEFF/, ''), { type: 'string', raw: false })
    : XLSX.read(data, { type: 'buffer', raw: false, cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false, raw: false }) as unknown[][])
    .map((r) => r.map((c) => (c == null ? '' : String(c))));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    const text = form.get('text');
    let table: string[][];
    if (typeof text === 'string') {
      if (!text.trim()) return NextResponse.json({ error: 'Paste some rows first.' }, { status: 400 });
      if (text.length > MAX_BYTES) return NextResponse.json({ error: 'That is more than 10 MB of text.' }, { status: 400 });
      try { table = readTable(text, true); } catch {
        return NextResponse.json({ error: 'Could not read the pasted rows. Copy them from a sheet, or separate columns with commas.' }, { status: 400 });
      }
    } else {
      if (!(file instanceof Blob)) return NextResponse.json({ error: 'Attach a .csv or .xlsx file.' }, { status: 400 });
      if (file.size > MAX_BYTES) return NextResponse.json({ error: 'The file is larger than 10 MB.' }, { status: 400 });
      const name = file instanceof File ? file.name.toLowerCase() : '';
      const bytes = Buffer.from(await file.arrayBuffer());
      try { table = /\.(csv|txt|tsv)$/.test(name) ? readTable(bytes.toString('utf8'), true) : readTable(bytes, false); } catch {
        return NextResponse.json({ error: 'Could not read that file. Save it as .csv or .xlsx and try again.' }, { status: 400 });
      }
    }
    // The header is the first row with at least two filled cells (fair lists often start with a title line).
    const hi = table.findIndex((r) => r.filter((c) => c.trim()).length >= 2);
    if (hi < 0) return NextResponse.json({ error: 'No header row found: the first row needs at least two column names (e.g. Name, Company).' }, { status: 400 });
    const headers = table[hi].map((h, i) => h.trim() || `Column ${i + 1}`);
    const rows = table.slice(hi + 1).filter((r) => r.some((c) => c.trim()));
    if (rows.length > MAX_ROWS) return NextResponse.json({ error: `At most ${MAX_ROWS} rows at a time; this has ${rows.length}.` }, { status: 400 });
    // Header first, then the values: a column holding linkedin.com/in links is the LinkedIn URL whatever it is called
    // (LinkedIn's own connections export names it "URL"), and one holding @ addresses is the email.
    const mapping = headers.map((h, i) => {
      const sample = rows.slice(0, 50).map((r) => (r[i] || '').toLowerCase()).filter(Boolean);
      const share = (re: RegExp) => (sample.length ? sample.filter((v) => re.test(v)).length / sample.length : 0);
      if (share(/linkedin\.com\/in\//) >= 0.5) return 'linkedin_url';
      const g = guessField(h);
      if (!g && share(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/) >= 0.5) return 'email';
      return g;
    });
    return NextResponse.json({ headers, rows, mapping });
  }

  let body: { rows?: ImportRow[]; list_name?: string; met_at?: string; priority?: number | string; responsible?: string; front?: string; icp_id?: string; dry_run?: boolean } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) : [];
  if (!rows.length) return NextResponse.json({ error: 'No rows to import.' }, { status: 400 });
  const dry = body.dry_run !== false;
  const base: Record<string, unknown> = { dry_run: dry };
  for (const k of ['list_name', 'met_at', 'responsible', 'front', 'icp_id'] as const) if (body[k]) base[k] = String(body[k]).trim();
  if (body.priority) base.priority = Number(body.priority);

  const results: ImportResult[] = [];
  const total = { new: 0, created: 0, duplicate: 0, error: 0, prospects_linked: 0, added_to_list: 0 };
  let source = '';
  let listName = '';
  // A preview of a file bigger than one chunk cannot see twins across chunks in the kernel; catch them here.
  const seen = new Map<string, number>();
  try {
    for (let start = 0; start < rows.length; start += CHUNK) {
      const chunk = rows.slice(start, start + CHUNK).map((r) => ({ ...r, notes: r.notes ? String(r.notes).slice(0, 1000) : undefined }));
      const out = await kernelCall('crm_sales_leads_import', { ...base, rows: chunk }, session.userId) as Record<string, unknown>;
      source = String(out.source || source);
      listName = String(out.list_name || listName);
      for (const r of (out.results as ImportResult[]) || []) {
        const row = { ...r, row: r.row + start };
        if (dry && row.status === 'new') {
          const src = rows[row.row - 1] || {};
          const keys = [src.email?.toLowerCase(), src.linkedin_url?.toLowerCase(), `${(row.name || '').toLowerCase()}|${(src.company || '').toLowerCase()}`].filter(Boolean) as string[];
          const twin = keys.map((k) => seen.get(k)).find((v) => v !== undefined);
          if (twin !== undefined) { row.status = 'duplicate'; row.reason = `same person as row ${twin}`; }
          else keys.forEach((k) => seen.set(k, row.row));
        }
        results.push(row);
      }
      total.prospects_linked += Number(out.prospects_linked || 0);
      total.added_to_list += Number(out.added_to_list || 0);
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), results }, { status: 400 });
  }
  for (const r of results) total[r.status] += 1;
  return NextResponse.json({ dry_run: dry, rows: rows.length, source, ...(listName ? { list_name: listName } : {}), ...total, results });
}
