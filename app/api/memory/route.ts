import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * GET  /api/memory?user_id=&scope=&status= — my notes + the team's (an admin may
 *      name another user; their personal notes are read-only here).
 * POST /api/memory {content, scope?, kind?} — save a note as the logged-in user.
 *      Goes through `crm_memory_save` so the attended-turn rule, the secret-shape
 *      refusal and the audit row are the same as in chat.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const args: Record<string, unknown> = {};
  if (p.get('user_id')) args.user_id = p.get('user_id');
  if (p.get('scope')) args.scope = p.get('scope');
  if (p.get('status')) args.status = p.get('status');
  try {
    return NextResponse.json(await kernelCall('memory_list', args, session.userId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Memory list failed: ${msg}` }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 });
  const args: Record<string, unknown> = { content, source: 'app' };
  if (body.scope === 'team' || body.scope === 'personal') args.scope = body.scope;
  if (typeof body.kind === 'string') args.kind = body.kind;
  try {
    const out = await kernelCall('crm_memory_save', args, session.userId);
    const refused = (out as { refused?: boolean }).refused === true;
    return NextResponse.json(out, { status: refused ? 422 : 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Save failed: ${msg}` }, { status: 502 });
  }
}
