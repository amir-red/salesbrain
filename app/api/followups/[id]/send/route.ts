import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * Send a scheduled follow-up NOW.
 *
 * Since core 045 an email follow-up is a customer message and goes through the
 * send gate like every other one: the kernel files an approval
 * (kind='followup') and only an owner's decision releases it. A human pressing
 * this button IS that decision, so we propose and decide in one request, as
 * the session user. Reminders / SLA alerts carry no message and are just
 * marked done by the first call.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const filed = await kernelCall('crm_send_followup', { followup_id: params.id }, session.userId);
  if (filed.error) return NextResponse.json(filed, { status: 400 });
  if (!filed.approval_id) return NextResponse.json({ ok: true, ...filed }); // reminder / sla_alert: done

  const decided = await kernelCall(
    'crm_outreach_decide',
    { approval_id: filed.approval_id, decision: 'approve' },
    session.userId,
  );
  const sent = decided.sent === true;
  return NextResponse.json({ ok: sent, sent, approval_id: filed.approval_id, ...decided },
                           { status: sent ? 200 : 409 });
}
