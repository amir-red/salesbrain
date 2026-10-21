import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { GMAIL_SEND_SCOPES, getGoogleAuthUrl } from '@/lib/google-oauth';
import { signState } from '@/lib/signed-state';

/**
 * GET /api/email/connect — connect YOUR Gmail as a sending mailbox for email waves (core 076): Google's consent screen
 * with send + read permission. Same callback as the import connection; the signed state says which one this is.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.redirect(getGoogleAuthUrl(signState({ uid: session.userId, p: 'send' }), GMAIL_SEND_SCOPES));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'OAuth not configured' }, { status: 500 });
  }
}
