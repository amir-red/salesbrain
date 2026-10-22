import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * One campaign card: every draft one step produced for one sender on one day.
 *   GET  /api/campaigns/cards/[id]                       the card + its drafts (the sender, or an admin)
 *   POST /api/campaigns/cards/[id] { decision }          approve | skip — only the SENDER. Approved LinkedIn drafts go
 *                                                        out within the hour at a human pace; emails from their Gmail
 *   POST /api/campaigns/cards/[id] { drop: approval_id } take one person off the card (they leave the campaign)
 * Editing one draft's text uses /api/drafts/[id] {action:'edit'} like every other draft.
 */
function fail(err: unknown, status = 400) {
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const card = await kernelCall('campaign_card', { card_id: params.id }, session.userId);
    return NextResponse.json({ ...card, can_decide: String(card.sender_user_id) === session.userId });
  } catch (err) { return fail(err, 404); }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { decision?: string; drop?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  try {
    if (body.drop) return NextResponse.json(await kernelCall('campaign_draft_drop', { approval_id: body.drop }, session.userId));
    if (body.decision !== 'approve' && body.decision !== 'skip') {
      return NextResponse.json({ error: 'decision must be approve or skip' }, { status: 400 });
    }
    return NextResponse.json(await kernelCall('crm_campaign_card_decide', { card_id: params.id, decision: body.decision }, session.userId));
  } catch (err) { return fail(err); }
}
