import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * GET   /api/email/mailboxes   every connected sending mailbox (crm_email_mailboxes) + mine with its settings
 * PATCH /api/email/mailboxes   { display_name?, signature?, daily_cap? } — my own settings (crm_email_mailbox_update)
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const all = await kernelCall('crm_email_mailboxes', {}, session.userId);
    const { rows } = await pool.query(
      `SELECT address, display_name, signature, daily_cap, connected_at, revoked_at, last_sent_at, last_error
         FROM email_senders WHERE user_id = $1`, [session.userId]);
    return NextResponse.json({ ...all, mine: rows[0] ?? null });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const args: Record<string, unknown> = {};
  for (const k of ['display_name', 'signature', 'daily_cap'] as const) if (body[k] !== undefined) args[k] = body[k];
  try {
    return NextResponse.json(await kernelCall('crm_email_mailbox_update', args, session.userId));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
