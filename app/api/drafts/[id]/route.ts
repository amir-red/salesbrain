import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/** GET → the draft as the feedback UI reads it (098): the model's text next to the final, why it was written,
 * which facts, the rating and chips so far. The sender's own rows, any as admin. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { rows } = await pool.query(
    `SELECT id, status, message, draft_original, draft_reasoning, draft_facts, edit_ratio, rating, feedback_source,
            feedback_keys, decided_by, kind, channel, owner_user_id
       FROM outreach_approvals WHERE id = $1`, [params.id]);
  const r = rows[0];
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (session.role !== 'admin' && String(r.owner_user_id) !== session.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { owner_user_id: _o, ...rest } = r;
  return NextResponse.json(rest);
}

/**
 * One draft (an outreach_approvals row) — Brand & Voice, core 079.
 *   POST {action:'edit', text}                               replace the text of a PENDING draft (the model's
 *                                                            version is kept); the Telegram card is updated too
 *   POST {action:'feedback', rating?, reasons?, reason?, edited_text?}
 *                                                            the person's 1–10 and why; a lesson becomes a rule in
 *                                                            the SENDER's own voice at once (crm_draft_feedback)
 * The kernel refuses anyone but the draft's sender (or an admin).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { action?: string; text?: string; rating?: number; reasons?: string[]; reason?: string; edited_text?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  try {
    if (body.action === 'edit') {
      if (!body.text?.trim()) return NextResponse.json({ error: 'The new text is empty' }, { status: 400 });
      const out = await kernelCall('crm_draft_edit', { approval_id: params.id, text: body.text }, session.userId);
      return NextResponse.json(out, { status: out.error ? 400 : 200 });
    }
    if (body.action === 'feedback') {
      const rating = body.rating == null ? undefined : Number(body.rating);
      if (rating !== undefined && !(Number.isInteger(rating) && rating >= 1 && rating <= 10)) {
        return NextResponse.json({ error: 'Rating must be a whole number from 1 to 10' }, { status: 400 });
      }
      const out = await kernelCall('crm_draft_feedback', {
        approval_id: params.id,
        ...(rating !== undefined ? { rating } : {}),
        ...(Array.isArray(body.reasons) && body.reasons.length ? { reasons: body.reasons.slice(0, 7) } : {}),
        ...(body.reason?.trim() ? { reason: body.reason.trim().slice(0, 500) } : {}),
        ...(body.edited_text?.trim() ? { edited_text: body.edited_text } : {}),
      }, session.userId);
      return NextResponse.json(out, { status: out.error ? 400 : 200 });
    }
    return NextResponse.json({ error: "action must be 'edit' or 'feedback'" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
