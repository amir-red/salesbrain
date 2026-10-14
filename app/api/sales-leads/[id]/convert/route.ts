/**
 * POST /api/sales-leads/:id/convert — turn a sales lead into a G1 sales deal.
 *
 * Runs through the kernel (`crm_convert_lead`) so the app and the agent
 * convert the same way: the deal's creator is the lead's BACK OFFICE and its
 * project lead the FRONT OFFICE (the caller where a seat is empty), the booked
 * demo / website / where-met / their message / our notes become the deal
 * notes, the track record gets the line, and both roles are told.
 * Idempotent: an already converted lead returns the existing deal id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const out = await kernelCall('crm_convert_lead', { lead_id: id }, session.userId) as Record<string, unknown>;
    if (out.error) return NextResponse.json({ error: String(out.error) }, { status: /not found/i.test(String(out.error)) ? 404 : 400 });
    return NextResponse.json(
      { deal_id: out.deal_id, already_converted: Boolean(out.already_converted), deal_creator: out.deal_creator ?? null, deal_lead: out.deal_lead ?? null },
      { status: out.already_converted ? 200 : 201 },
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Convert failed' }, { status: 500 });
  }
}
