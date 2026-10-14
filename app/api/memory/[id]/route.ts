import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * POST /api/memory/[id] {action: 'forget' | 'share'} — supersede one of my notes,
 * or propose it to the team. Owner (or admin) only, enforced by the kernel.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const tool = body.action === 'forget' ? 'crm_memory_forget' : body.action === 'share' ? 'crm_memory_share' : null;
  if (!tool) return NextResponse.json({ error: 'action must be forget or share' }, { status: 400 });
  try {
    const out = await kernelCall(tool, { memory_id: params.id }, session.userId);
    return NextResponse.json(out, { status: (out as { error?: string }).error ? 409 : 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `${body.action} failed: ${msg}` }, { status: 502 });
  }
}
