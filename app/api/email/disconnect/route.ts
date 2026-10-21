import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

/** POST /api/email/disconnect — stop sending from my mailbox: tokens deleted, the mailbox marked revoked. Approved
 *  wave emails that were not sent yet stay approved and go out once a mailbox is connected again. */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await pool.query(`DELETE FROM oauth_tokens WHERE user_id = $1 AND provider = 'gmail_send'`, [session.userId]);
  await pool.query(`UPDATE email_senders SET revoked_at = now(), updated_at = now() WHERE user_id = $1`, [session.userId]);
  return NextResponse.json({ disconnected: true });
}
