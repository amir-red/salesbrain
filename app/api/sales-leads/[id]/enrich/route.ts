/**
 * POST /api/sales-leads/:id/enrich  { step: 'linkedin' | 'website' | 'email' | 'pick', public_identifier?, member_id? }
 *
 * ONE enrichment step for a lead card (the Enrich button calls the three in order so it can draw a real progress bar).
 * Goes through the kernel tool `crm_enrich_lead`: it finds or creates the prospect behind the lead, runs the Enricher's
 * own LinkedIn / company-research / email steps as the prospect's OWNER (their LinkedIn account, their budgets), and
 * copies what it found back onto the card, filling only empty fields. Allowed for the lead's back office, front office,
 * its owner and admins; the kernel decides. Phone is deliberately not a step.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

const Body = z.object({
  step: z.enum(['linkedin', 'website', 'email', 'pick']),
  public_identifier: z.string().max(200).optional(),
  member_id: z.string().max(200).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  let raw: unknown = {};
  try { raw = await req.json(); } catch { /* validated below */ }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  try {
    const out = (await kernelCall('crm_enrich_lead', { lead_id: id, ...parsed.data }, session.userId)) as Record<string, unknown>;
    if (out.error) {
      const msg = String(out.error);
      return NextResponse.json({ error: msg }, { status: /only the lead|not found/i.test(msg) ? 403 : 400 });
    }
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
