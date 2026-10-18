import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * The bot's knowledge base (core 072).
 * GET  /api/knowledge?status=active|archived&scope=team|personal — admin: every entry with its author; others: team
 *      entries + their own personal ones.
 * POST /api/knowledge {action:'save', title, body, keywords?, kind?, scope?, tool_hint?, replaces?}
 *      {action:'archive', id}
 * A non-admin saves personal entries only; the kernel refuses archiving someone else's personal entry.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;
const KINDS = new Set(['concept', 'message', 'phrase', 'procedure']);

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const status = req.nextUrl.searchParams.get('status') === 'archived' ? 'archived' : 'active';
  const scope = req.nextUrl.searchParams.get('scope');
  try {
    const out = await kernelCall('knowledge_list', { status, ...(scope === 'team' || scope === 'personal' ? { scope } : {}) },
      session.userId);
    return NextResponse.json({ ...(out as object), viewer_is_admin: session.role === 'admin' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Knowledge failed: ${msg}` }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '');
  try {
    if (b.action === 'archive') {
      if (!UUID.test(str('id'))) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const out = await kernelCall('knowledge_archive', { entry_id: str('id') }, session.userId);
      return NextResponse.json(out, { status: (out as { error?: string }).error ? 409 : 200 });
    }
    if (b.action === 'save') {
      const scope = session.role === 'admin' && str('scope') === 'team' ? 'team' : 'personal';
      const kind = KINDS.has(str('kind')) ? str('kind') : 'concept';
      const out = (await kernelCall('knowledge_save', {
        title: str('title'), body: str('body'), keywords: str('keywords'), kind, scope,
        tool_hint: str('tool_hint') || null,
      }, session.userId)) as { error?: string; ok?: boolean };
      // A renamed entry is a new title: archive the one it replaces so the old wording stops being retrieved.
      if (out.ok && UUID.test(str('replaces'))) {
        await kernelCall('knowledge_archive', { entry_id: str('replaces') }, session.userId).catch(() => null);
      }
      return NextResponse.json(out, { status: out.error ? 409 : 200 });
    }
    return NextResponse.json({ error: "action must be 'save' or 'archive'" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Knowledge failed: ${msg}` }, { status: 502 });
  }
}
