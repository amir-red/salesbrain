import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/** POST {prospect_id | deal_id, priority 1..10 | 0 = clear} — the one person priority (kernel `crm_set_priority`). */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { prospect_id?: string; deal_id?: string; priority?: number } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const priority = Number(body.priority);
  if (!Number.isInteger(priority) || priority < 0 || priority > 10) return NextResponse.json({ error: 'priority is 1 (top) … 10, or 0 to clear' }, { status: 400 });
  if (!body.prospect_id && !body.deal_id) return NextResponse.json({ error: 'prospect_id or deal_id required' }, { status: 400 });
  try {
    const out = await kernelCall('crm_set_priority', { prospect_id: body.prospect_id, deal_id: body.deal_id, priority }, session.userId);
    return NextResponse.json(out, { status: out.error ? (out.refused ? 403 : 400) : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
