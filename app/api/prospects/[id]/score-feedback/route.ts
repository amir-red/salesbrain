import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/** POST {direction: up|down, note?} — the viewer's ✓ / ↓ on a person's rank (kernel `crm_score_feedback`, audited). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { direction?: string; note?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (body.direction !== 'up' && body.direction !== 'down') return NextResponse.json({ error: 'direction must be up or down' }, { status: 400 });
  try {
    const out = await kernelCall('crm_score_feedback', { prospect_id: params.id, direction: body.direction, note: body.note || undefined }, session.userId);
    return NextResponse.json(out, { status: out.error ? (out.refused ? 403 : 400) : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
