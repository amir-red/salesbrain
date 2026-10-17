/**
 * POST /api/sales-leads/:id/automation  { paused: boolean, reason?: string }
 *
 * Hands one lead off (paused) or back to the Lead Conductor. A paused lead is never set up, connected, messaged or
 * followed up by the system; it stays on the list and the pause is a dated line on its track record. Goes through
 * the kernel (crm_lead_automation_pause) so it is audited like the agent's own edits.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

const Body = z.object({ paused: z.boolean(), reason: z.string().max(300).optional() }).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  try {
    const out = await kernelCall('crm_lead_automation_pause', { lead_id: id, ...parsed.data }, session.userId);
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
