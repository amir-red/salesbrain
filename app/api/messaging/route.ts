/**
 * Profile → Messaging (core 100): the ways WhatsApp / iMessage / Telegram conversations reach my Inbox.
 *
 *   GET                                   → my sources (never the Zeami link itself, only its last characters)
 *   POST {action:'zeami', link, label?}   → add / replace my Zeami Messaging private link (checked with one real read)
 *   POST {action:'sync'}                  → read my sources now
 *   DELETE ?kind=zeami_link|unipile_whatsapp|mac_push → stop one (a WhatsApp connection is deleted at Unipile too)
 *
 * Session-authed: the person acted for is always the browser's user.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

export const dynamic = 'force-dynamic';

const KINDS = ['zeami_link', 'unipile_whatsapp', 'mac_push'];

function fail(err: unknown) {
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const out = await kernelCall('messaging_sources', {}, session.userId);
    return NextResponse.json(out, { status: out.error ? 400 : 200 });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { action?: string; link?: string; label?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  try {
    if (body.action === 'zeami') {
      const link = (body.link || '').trim();
      if (!link) return NextResponse.json({ error: 'Paste your private link first.' }, { status: 400 });
      const out = await kernelCall('messaging_zeami_add', { link, ...(body.label ? { label: body.label.slice(0, 60) } : {}) }, session.userId);
      if (out.error) return NextResponse.json(out, { status: 400 });
      // Read it once now, so the Inbox has the conversations before the next 10-minute run.
      const synced = await kernelCall('messaging_sync_now', {}, session.userId).catch(() => null);
      return NextResponse.json({ ...out, synced });
    }
    if (body.action === 'sync') {
      const out = await kernelCall('messaging_sync_now', {}, session.userId);
      return NextResponse.json(out, { status: out.error ? 400 : 200 });
    }
  } catch (err) {
    return fail(err);
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const kind = req.nextUrl.searchParams.get('kind') || '';
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'Unknown kind' }, { status: 400 });
  try {
    const out = await kernelCall('messaging_source_revoke', { kind }, session.userId);
    return NextResponse.json(out, { status: out.error ? 400 : 200 });
  } catch (err) {
    return fail(err);
  }
}
