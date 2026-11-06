import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { getAccepted, renderTemplate } from '@/lib/inbox-accepted';
import { cleanStamp, draftInVoice, templateStamp } from '@/lib/voice-context';

/**
 * One accepted request in the Inbox (2026-11-06).
 * GET  — the row.
 * POST {action:'draft'}                  — the list's first-message template, else an AI first message in the owner's voice.
 * POST {action:'send', text, voice?}     — sends the first message now from the owner's LinkedIn: the waiting card is
 *                                          edited (when the text changed) and approved; with no card one is filed and
 *                                          approved. Pressing Send is the owner's decision; the send gate still checks.
 * POST {action:'skip'}                   — skips the waiting card.
 * Only the account's owner may draft, send or skip.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const it = await getAccepted(params.id, { userId: session.userId, admin: session.role === 'admin' });
  return it ? NextResponse.json({ item: it }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const viewer = { userId: session.userId, admin: session.role === 'admin' };
  const it = await getAccepted(params.id, viewer);
  if (!it) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!it.mine) return NextResponse.json({ error: `Only ${it.owner_name || 'the account owner'} can message from their LinkedIn.` }, { status: 403 });
  let body: { action?: string; text?: string; voice?: unknown } = {};
  try { body = await req.json(); } catch { /* empty */ }

  try {
    if (body.action === 'draft') {
      if (!it.prospect_id) return NextResponse.json({ error: 'Not a lead yet — message them on LinkedIn, or add them as a lead first.' }, { status: 409 });
      if (it.template) {
        const text = renderTemplate(it.template, it);
        return NextResponse.json({ message: text, source: 'template', reasoning: `The first-message text of the list “${it.list_name}”.`,
          used_facts: [], priorities: [], voice: templateStamp(text, 'first_message_template') });
      }
      const out = await draftInVoice({ situation: 'first', channel: 'linkedin', feature: 'inbox_accepted', userId: session.userId,
        prospectId: it.prospect_id,
        angle: 'They just accepted our connection request: thank them briefly, give one specific reason we are reaching out, ask one easy question.' });
      if ('error' in out) return NextResponse.json({ error: out.error }, { status: 502 });
      return NextResponse.json({ ...out, source: 'model' });
    }

    if (body.action === 'skip') {
      if (!it.approval_id) return NextResponse.json({ error: 'No card is waiting.' }, { status: 409 });
      const out = await kernelCall('crm_outreach_decide', { approval_id: it.approval_id, decision: 'reject' }, session.userId) as Record<string, unknown>;
      return NextResponse.json(out, { status: out.error ? 400 : 200 });
    }

    if (body.action === 'send') {
      const text = (body.text ?? '').trim();
      if (!text) return NextResponse.json({ error: 'Write the message first.' }, { status: 400 });
      if (!it.prospect_id) return NextResponse.json({ error: 'Not a lead yet — message them on LinkedIn.' }, { status: 409 });
      if (it.status === 'messaged') return NextResponse.json({ error: 'There is already a conversation — answer it in the LinkedIn tab.' }, { status: 409 });
      let approvalId = it.approval_id;
      if (approvalId) {
        if (text !== (it.approval_message ?? '').trim()) {
          const e = await kernelCall('crm_draft_edit', { approval_id: approvalId, text }, session.userId) as Record<string, unknown>;
          if (e.error) return NextResponse.json(e, { status: 400 });
        }
      } else {
        const voice = cleanStamp(body.voice);
        const p = await kernelCall('crm_linkedin_first_message_propose', { prospect_id: it.prospect_id, text, ...(voice ? { voice } : {}) },
          session.userId) as Record<string, unknown>;
        if (p.error) return NextResponse.json(p, { status: 400 });
        approvalId = String(p.approval_id ?? '');
        if (!approvalId) return NextResponse.json({ error: 'The draft was not filed.' }, { status: 502 });
      }
      const out = await kernelCall('crm_outreach_decide', { approval_id: approvalId, decision: 'approve' }, session.userId) as Record<string, unknown>;
      return NextResponse.json({ ...out, approval_id: approvalId }, { status: out.error ? 400 : 200 });
    }
    return NextResponse.json({ error: 'action must be draft | send | skip' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
