import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { guessField, type ImportResult, type ImportRow } from '@/lib/lead-import';

/**
 * POST /api/sales-leads/import
 *   multipart (file = .csv / .xlsx / .xls) → { headers, rows, mapping }   read the file, guess the columns; writes nothing
 *   JSON { rows: ImportRow[], list_name?, met_at?, priority?, responsible?, front?, dry_run } → ImportSummary
 * The JSON form goes to the kernel (crm_sales_leads_import) 100 rows at a time — dedupe, roles, track record and the
 * prospect behind every created lead live there. 2,000 rows per file at most.
 */
const MAX_ROWS = 2000;
const CHUNK = 100;
const MAX_BYTES = 10 * 1024 * 1024;

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof Blob)) return NextResponse.json({ error: 'Attach a .csv or .xlsx file.' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'The file is larger than 10 MB.' }, { status: 400 });
    let table: string[][];
    try {
      const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer', raw: false, cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      table = (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false, raw: false }) as unknown[][])
        .map((r) => r.map((c) => (c == null ? '' : String(c))));
    } catch {
      return NextResponse.json({ error: 'Could not read that file. Save it as .csv or .xlsx and try again.' }, { status: 400 });
    }
    // The header is the first row with at least two filled cells (fair lists often start with a title line).
    const hi = table.findIndex((r) => r.filter((c) => c.trim()).length >= 2);
    if (hi < 0) return NextResponse.json({ error: 'The file has no header row.' }, { status: 400 });
    const headers = table[hi].map((h, i) => h.trim() || `Column ${i + 1}`);
    const rows = table.slice(hi + 1).filter((r) => r.some((c) => c.trim()));
    if (rows.length > MAX_ROWS) return NextResponse.json({ error: `At most ${MAX_ROWS} rows per file; this one has ${rows.length}.` }, { status: 400 });
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

  let body: { rows?: ImportRow[]; list_name?: string; met_at?: string; priority?: number | string; responsible?: string; front?: string; dry_run?: boolean } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) : [];
  if (!rows.length) return NextResponse.json({ error: 'No rows to import.' }, { status: 400 });
  const dry = body.dry_run !== false;
  const base: Record<string, unknown> = { dry_run: dry };
  for (const k of ['list_name', 'met_at', 'responsible', 'front'] as const) if (body[k]) base[k] = String(body[k]).trim();
  if (body.priority) base.priority = Number(body.priority);

  const results: ImportResult[] = [];
  const total = { new: 0, created: 0, duplicate: 0, error: 0, prospects_linked: 0 };
  let source = '';
  // A preview of a file bigger than one chunk cannot see twins across chunks in the kernel; catch them here.
  const seen = new Map<string, number>();
  try {
    for (let start = 0; start < rows.length; start += CHUNK) {
      const chunk = rows.slice(start, start + CHUNK).map((r) => ({ ...r, notes: r.notes ? String(r.notes).slice(0, 1000) : undefined }));
      const out = await kernelCall('crm_sales_leads_import', { ...base, rows: chunk }, session.userId) as Record<string, unknown>;
      source = String(out.source || source);
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
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), results }, { status: 400 });
  }
  for (const r of results) total[r.status] += 1;
  return NextResponse.json({ dry_run: dry, rows: rows.length, source, ...total, results });
}
