import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * POST — rate and correct a draft WITHOUT filing it (the lead card's Before / After review, core 098).
 * {before, after?, rating 1–5, reason?, reasons?, prospect_id?, channel?, step?}. The card's 1–5 is stored ×2 on the
 * kernel's 1–10 scale. The lesson lands in the SENDER's voice (the prospect's owner); the kernel refuses anyone but the
 * sender or an admin.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let b: { before?: string; after?: string; rating?: number; reason?: string; reasons?: string[]; prospect_id?: string; channel?: string; step?: string } = {};
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!b.before?.trim()) return NextResponse.json({ error: 'There is no draft to learn from' }, { status: 400 });
  const r = b.rating == null ? undefined : Number(b.rating);
  if (r !== undefined && !(Number.isInteger(r) && r >= 1 && r <= 5)) return NextResponse.json({ error: 'Rating must be 1 to 5' }, { status: 400 });
  try {
    const out = await kernelCall('draft_teach', {
      before: b.before.slice(0, 6000), after: (b.after ?? '').slice(0, 6000),
      ...(r !== undefined ? { rating: r * 2 } : {}),
      ...(b.reason?.trim() ? { reason: b.reason.trim().slice(0, 500) } : {}),
      ...(Array.isArray(b.reasons) && b.reasons.length ? { reasons: b.reasons.slice(0, 8) } : {}),
      ...(b.prospect_id ? { prospect_id: b.prospect_id } : {}),
      channel: b.channel === 'email' || b.channel === 'whatsapp' ? b.channel : 'linkedin',
      step: ['first', 'followup', 'reply', 'intro', 'connect'].includes(b.step ?? '') ? b.step : 'first',
    }, session.userId);
    return NextResponse.json(out, { status: out.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
