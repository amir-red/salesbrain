import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getSession } from '@/lib/auth';
import { guardEditable, visibleIcp } from '@/lib/icp-server';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { guessFirmField, type FirmImportResult, type FirmImportRow } from '@/lib/firms';

/**
 * GET  /api/icp/[id]/firms?status=&eligibility=&q=   the firms on this list (crm_firm_list)
 * POST /api/icp/[id]/firms
 *   multipart (file = .csv / .xlsx) → { headers, rows, mapping }      read the file, guess the columns; writes nothing
 *   JSON { rows: FirmImportRow[], dry_run }  → summary                 crm_firm_import, 100 rows per kernel call
 * The kernel decides visibility (list owner or admin), dedupes firms and creates the accounts.
 */
const MAX_ROWS = 2000;
const CHUNK = 100;
const MAX_BYTES = 10 * 1024 * 1024;

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const fail = (err: unknown, status = 400) => NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await visibleIcp(params.id, session))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const args: Record<string, unknown> = { icp_id: params.id };
  for (const k of ['status', 'eligibility', 'q'] as const) if (sp.get(k)) args[k] = sp.get(k);
  try {
    return NextResponse.json(await kernelCall('crm_firm_list', args, session.userId));
  } catch (err) { return fail(err); }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const guard = await guardEditable(params.id, session);
  if (guard.denied) return guard.denied;

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
    const hi = table.findIndex((r) => r.filter((c) => c.trim()).length >= 2);
    if (hi < 0) return NextResponse.json({ error: 'The file has no header row.' }, { status: 400 });
    const headers = table[hi].map((h, i) => h.trim() || `Column ${i + 1}`);
    const rows = table.slice(hi + 1).filter((r) => r.some((c) => c.trim()));
    if (rows.length > MAX_ROWS) return NextResponse.json({ error: `At most ${MAX_ROWS} rows per file; this one has ${rows.length}.` }, { status: 400 });
    // One column per field: the first header that matches wins (a ranked list has both "Company" and "Website").
    const used = new Set<string>();
    const mapping = headers.map((h, i) => {
      const sample = rows.slice(0, 50).map((r) => (r[i] || '').toLowerCase()).filter(Boolean);
      const share = (re: RegExp) => (sample.length ? sample.filter((v) => re.test(v)).length / sample.length : 0);
      let g = guessFirmField(h);
      if (!g && share(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/) >= 0.5) g = 'contact_email';
      if (!g || used.has(g)) return '';
      used.add(g);
      return g;
    });
    return NextResponse.json({ headers, rows, mapping });
  }

  let body: { rows?: FirmImportRow[]; dry_run?: boolean } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) : [];
  if (!rows.length) return NextResponse.json({ error: 'No firms to import.' }, { status: 400 });
  const dry = body.dry_run !== false;
  const results: FirmImportResult[] = [];
  // Twins across chunks: the kernel only sees one chunk at a time.
  const seen = new Map<string, number>();
  try {
    for (let start = 0; start < rows.length; start += CHUNK) {
      const chunk = rows.slice(start, start + CHUNK).map((r) => ({ ...r, notes: r.notes ? String(r.notes).slice(0, 2000) : undefined }));
      const out = await kernelCall('crm_firm_import', { icp_id: params.id, rows: chunk, dry_run: dry }, session.userId) as Record<string, unknown>;
      for (const r of (out.results as FirmImportResult[]) || []) {
        const row = { ...r, row: r.row + start };
        const key = (row.firm || '').trim().toLowerCase();
        if (row.status === 'new' || row.status === 'created') {
          const twin = seen.get(key);
          if (twin !== undefined && dry) { row.status = 'duplicate'; row.reason = `same firm as row ${twin}`; }
          else seen.set(key, row.row);
        }
        results.push(row);
      }
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), results }, { status: 400 });
  }
  const total = { new: 0, created: 0, duplicate: 0, error: 0 };
  for (const r of results) total[r.status] += 1;
  return NextResponse.json({ dry_run: dry, rows: rows.length, ...total, results });
}
