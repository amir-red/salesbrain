/**
 * PATCH /api/sales-leads/:id/events/:eventId — correct one track-record line
 * (text and/or occurred_at YYYY-MM-DD). The kernel enforces who may: the line's
 * author or an admin, hand-written kinds only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

const Schema = z.object({
  text: z.string().min(1).max(2000).optional(),
  occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { eventId } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  try {
    const out = await kernelCall('crm_edit_sales_lead_event', { event_id: eventId, ...parsed.data }, session.userId) as Record<string, unknown>;
    if (out.error) return NextResponse.json({ error: out.error }, { status: 403 });
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
