import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getSession } from '@/lib/auth';
import { TEMPLATE_COLUMNS } from '@/lib/lead-import';

/**
 * GET /api/sales-leads/import/template?format=xlsx|csv — the lead-import template. Its headers are exactly the ones the
 * import recognises (lib/lead-import.ts), so a filled template maps itself with nothing to adjust. The Excel version
 * has a second sheet that explains each column.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const csv = req.nextUrl.searchParams.get('format') === 'csv';
  const header = TEMPLATE_COLUMNS.map((c) => c.header);
  const example = TEMPLATE_COLUMNS.map((c) => c.example);
  const leads = XLSX.utils.aoa_to_sheet([header, example]);
  leads['!cols'] = TEMPLATE_COLUMNS.map((c) => ({ wch: Math.max(14, c.header.length + 2, Math.min(40, c.example.length + 2)) }));
  if (csv) {
    const body = XLSX.utils.sheet_to_csv(leads);
    return new NextResponse('\uFEFF' + body, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="salesbrain-lead-import-template.csv"' },
    });
  }
  const help = XLSX.utils.aoa_to_sheet([
    ['Column', 'What goes in it'],
    ...TEMPLATE_COLUMNS.map((c) => [c.header, c.help || '—']),
    [],
    ['How to use', 'One person per row on the “Leads” sheet. Replace the example row. Keep the header row as it is.'],
    ['', 'Then on /sales-leads: Import a list → choose this file → Check → Import.'],
    ['', 'People already on the list (same email, LinkedIn profile, or name at the same company) are skipped, never merged.'],
  ]);
  help['!cols'] = [{ wch: 16 }, { wch: 90 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, leads, 'Leads');
  XLSX.utils.book_append_sheet(wb, help, 'How to fill it');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="salesbrain-lead-import-template.xlsx"',
    },
  });
}
