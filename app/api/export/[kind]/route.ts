/**
 * GET /api/export/{sales-leads|prospects|icp}?… — an .xlsx of what the matching screen shows, as the signed-in user.
 * sales-leads: view, sort, q, mine, role   ·   prospects: stage, mine, icp_id, reply_status, q   ·   icp: icp_id
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { buildExport, cleanArgs } from '@/lib/export/build';
import { xlsxResponse } from '@/lib/export/respond';
import { EXPORT_KINDS, type ExportKind } from '@/lib/export/sign';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { kind } = await params;
  if (!EXPORT_KINDS.includes(kind as ExportKind)) return NextResponse.json({ error: `Unknown export: ${kind}` }, { status: 404 });
  const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
  try {
    const built = await buildExport(
      { kind: kind as ExportKind, args: cleanArgs(kind as ExportKind, raw) },
      { userId: session.userId, role: session.role },
    );
    return xlsxResponse(built);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Export failed' }, { status: 400 });
  }
}
