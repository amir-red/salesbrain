/**
 * GET /api/export/download?t=<signed token> — the link an MCP tool hands back. No cookie: the token (HMAC over
 * who / what / expiry, 15 minutes) is the credential. The user's role is re-read here, never taken from the token.
 */
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { buildExport } from '@/lib/export/build';
import { xlsxResponse } from '@/lib/export/respond';
import { verifyExport } from '@/lib/export/sign';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const v = verifyExport(req.nextUrl.searchParams.get('t') || '');
  if (!v) return NextResponse.json({ error: 'This download link is invalid or has expired — ask for a new one.' }, { status: 401 });
  const { rows } = await pool.query('SELECT id, role FROM users WHERE id = $1', [v.userId]);
  if (!rows[0]) return NextResponse.json({ error: 'Unknown user' }, { status: 401 });
  try {
    return xlsxResponse(await buildExport(v.req, { userId: rows[0].id as string, role: rows[0].role as string }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Export failed' }, { status: 400 });
  }
}
