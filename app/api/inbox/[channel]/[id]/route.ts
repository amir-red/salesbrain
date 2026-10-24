import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { getThread, setThreadState } from '@/lib/inbox-server';

/**
 * GET  /api/inbox/{email|linkedin}/{id} — one conversation (messages + who it is); opening it marks it seen for its
 *      owner.
 * POST {action:'reply', text} — sent at once from the owner's own account through the send gate (pressing Send is
 *      the decision; quiet hours / a cap keep it approved for the next window). Only the owner.
 *      {action:'done'|'reopen'} — the owner or an admin. {action:'refresh'} — re-read it now (owner).
 */
type Ctx = { params: { channel: string; id: string } };
const UUID = /^[0-9a-f-]{36}$/i;

function parse(params: Ctx['params']): { channel: 'email' | 'linkedin'; id: string } | null {
  if ((params.channel !== 'email' && params.channel !== 'linkedin') || !UUID.test(params.id)) return null;
  return { channel: params.channel, id: params.id };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const p = parse(params);
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const thread = await getThread(p.channel, p.id, { userId: session.userId, admin: session.role === 'admin' });
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ thread });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const p = parse(params);
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let body: { action?: string; text?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const viewer = { userId: session.userId, admin: session.role === 'admin' };

  if (body.action === 'done' || body.action === 'reopen') {
    const ok = await setThreadState(p.channel, p.id, body.action, viewer);
    return NextResponse.json(ok ? { ok: true } : { error: 'Not found' }, { status: ok ? 200 : 404 });
  }
  if (body.action === 'reply' || body.action === 'refresh') {
    const text = typeof body.text === 'string' ? body.text : '';
    if (body.action === 'reply' && !text.trim()) return NextResponse.json({ error: 'Write a reply first.' }, { status: 400 });
    try {
      const out = await kernelCall(body.action === 'reply' ? 'inbox_reply' : 'inbox_refresh',
        { channel: p.channel, thread_id: p.id, ...(body.action === 'reply' ? { text } : {}) }, session.userId);
      const thread = await getThread(p.channel, p.id, viewer);
      return NextResponse.json({ ...out, thread }, { status: out.error ? 400 : 200 });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
