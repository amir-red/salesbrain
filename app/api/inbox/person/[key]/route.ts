import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { cleanupPerson, getPerson, setPersonState } from '@/lib/inbox-server';
import { parseKey } from '@/lib/inbox';

/**
 * GET  /api/inbox/person/{person:<id> | prospect:<id> | em:<owner>:<address> | li:<owner>:<member> | <channel>:<id>} — one person's conversation across every
 *      channel we hold with them (2026-11-09): the merged timeline, one reply target per thread. Opening it marks
 *      your own threads seen.
 * POST {action:'done'|'reopen'} — on every thread of the person the viewer may act on (owner or admin).
 * POST {action:'delete'|'spam'|'optout'} (core 107) — on the viewer's OWN threads of the person: Delete / Mark as spam
 *      (also moved in Gmail when the connection allows it) / Opt out (never contact them, on every channel).
 * Replies, drafts and refreshes stay per thread: POST /api/inbox/{channel}/{id}.
 */
type Ctx = { params: { key: string } };
const UUID = /^[0-9a-f-]{36}$/i;
/** `em:<owner uuid>:<address>` / `li:<owner uuid>:<member id>` — the stranger keys */
const SAME = /^[0-9a-f-]{36}:[^\s]{1,200}$/i;

function parse(raw: string): string | null {
  let key: string;
  try { key = decodeURIComponent(raw); } catch { return null; }
  const k = parseKey(key);
  if (!k || k.kind === 'accepted') return null;
  if (k.kind === 'same' ? !SAME.test(k.id) : !UUID.test(k.id)) return null;
  return key;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const key = parse(params.key);
  if (!key) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const thread = await getPerson(key, { userId: session.userId, admin: session.role === 'admin' });
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ thread });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const key = parse(params.key);
  if (!key) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let body: { action?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  if (body.action === 'delete' || body.action === 'spam' || body.action === 'optout') {
    const res = await cleanupPerson(key, body.action, { userId: session.userId, admin: session.role === 'admin' });
    if (!res.changed) return NextResponse.json({ error: res.errors[0] || 'Only the owner of this conversation can do that.', ...res }, { status: 403 });
    return NextResponse.json({ ok: true, ...res });
  }
  if (body.action !== 'done' && body.action !== 'reopen') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  const n = await setPersonState(key, body.action, { userId: session.userId, admin: session.role === 'admin' });
  return NextResponse.json(n ? { ok: true, changed: n } : { error: 'Not found' }, { status: n ? 200 : 404 });
}
