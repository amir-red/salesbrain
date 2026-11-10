import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dropUpload, fileHeaders, readFile } from '@/lib/message-files';

/**
 * GET    /api/inbox/files/{id}[?inline=1] — a file we sent (or are about to send), for its uploader or an admin.
 * DELETE /api/inbox/files/{id}            — take an unsent upload out of the reply box.
 */
type Ctx = { params: { id: string } };
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const f = await readFile(params.id, { userId: session.userId, admin: session.role === 'admin' });
  if (!f) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const inline = req.nextUrl.searchParams.get('inline') === '1';
  return new NextResponse(new Uint8Array(f.content), { headers: fileHeaders(f.name, f.mime, f.content.length, inline) });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const ok = await dropUpload(session.userId, params.id);
  return NextResponse.json(ok ? { ok: true } : { error: 'Not found' }, { status: ok ? 200 : 404 });
}
