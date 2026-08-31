/**
 * Admin-only management of service tokens (the bearer secret a sibling app
 * uses on /api/service-mcp).
 *
 *   GET    → list active service tokens (prefix + app_key + label; never the raw).
 *   POST   { app_key, name } → mint a token; the RAW value is returned ONCE.
 *   DELETE ?id=<uuid>        → revoke a token (soft).
 *
 * Cookie/session authed like the rest of the app; admin role required.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createServiceToken, listServiceTokens, revokeServiceToken } from '@/lib/service-mcp/tokens';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (session.role !== 'admin') return { error: NextResponse.json({ error: 'Admin only' }, { status: 403 }) };
  return { session };
}

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  return NextResponse.json({ tokens: await listServiceTokens() });
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  let body: { app_key?: string; name?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.app_key || !body.name) {
    return NextResponse.json({ error: 'app_key and name are required' }, { status: 400 });
  }
  try {
    const { raw, row } = await createServiceToken(body.app_key, body.name);
    // raw is shown ONCE — the caller must store it now.
    return NextResponse.json({ token: raw, ...row });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const ok = await revokeServiceToken(id);
  return NextResponse.json({ revoked: ok });
}
