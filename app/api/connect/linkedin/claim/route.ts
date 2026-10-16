import { NextRequest, NextResponse } from 'next/server';
import { verifyState } from '@/lib/signed-state';
import { completeFlow, getOpenFlow } from '@/lib/connect-tokens';
import { claimLinkedInForUser } from '@/lib/linkedin-claim';
import { publicUrl } from '@/lib/public-url';
import { sendTelegram } from '@/lib/tg-notify';

/**
 * GET /api/connect/linkedin/claim?s=<signed state> — where Unipile returns the person after the hosted LinkedIn
 * login started from Telegram. The signed state + the still-open connect token say WHO; the account itself is
 * bound with the same safeguards as the browser claim (fresh, unbound, never more than one candidate).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const st = verifyState<{ uid: string; t: string }>(req.nextUrl.searchParams.get('s'));
  const done = (ok: boolean, reason?: string) =>
    publicUrl(req, `/connect/done?provider=linkedin&ok=${ok ? 1 : 0}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`);
  const flow = st ? await getOpenFlow(st.t, 'linkedin') : null;
  if (!st || !flow || flow.user_id !== st.uid) {
    return NextResponse.redirect(done(false, 'This link has expired or was already used. Ask the bot for a new one.'));
  }
  const { status, body } = await claimLinkedInForUser(flow.user_id);
  if (status === 200) {
    await completeFlow(flow.id, 'connected');
    await sendTelegram(flow.telegram_chat_id,
      `✅ LinkedIn connected${body.account ? ` (${String(body.account)})` : ''}. Your inbox syncs hourly, and the Leads Finder, enrichment and connection requests can now work from your account.`);
    return NextResponse.redirect(done(true));
  }
  const reason = String(body.error || 'could not bind the account');
  await completeFlow(flow.id, `failed: ${reason}`);
  await sendTelegram(flow.telegram_chat_id, `❌ LinkedIn was not connected: ${reason.slice(0, 200)}`);
  return NextResponse.redirect(done(false, reason));
}
