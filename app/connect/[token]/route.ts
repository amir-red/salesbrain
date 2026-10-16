import { NextRequest, NextResponse } from 'next/server';
import { openConnectToken } from '@/lib/connect-tokens';
import { signState } from '@/lib/signed-state';
import { getGoogleAuthUrl } from '@/lib/google-oauth';
import { unipileFetch } from '@/lib/unipile';
import { publicUrl } from '@/lib/public-url';
import { sendTelegram } from '@/lib/tg-notify';

/**
 * GET /connect/<token> — the link the Telegram bot hands out. No login: the one-time token is the identity for
 * this single step. Opening it consumes it, then the person is sent on to Google's consent screen or Unipile's
 * hosted LinkedIn login (the password is typed into THEIR page, never ours). Anything else — expired, used,
 * made up — gets a plain page, not a hint about which of those it was.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const flow = await openConnectToken(params.token).catch(() => null);
  const fail = () => NextResponse.redirect(publicUrl(req, '/connect/done?ok=0&reason=' + encodeURIComponent('This link has expired or was already used. Ask the bot for a new one.')));
  if (!flow) return fail();

  try {
    if (flow.provider === 'google') {
      return NextResponse.redirect(getGoogleAuthUrl(signState({ uid: flow.user_id, t: flow.id })));
    }
    // LinkedIn: a Unipile hosted-auth link whose return trips our claim route with a signed state.
    const expiresOn = new Date(Date.now() + 15 * 60_000).toISOString();
    const state = signState({ uid: flow.user_id, t: flow.id }, 1200);
    const res = await unipileFetch('hosted/accounts/link', {
      method: 'POST',
      body: {
        type: 'create',
        providers: ['LINKEDIN'],
        api_url: process.env.UNIPILE_DSN?.startsWith('http') ? process.env.UNIPILE_DSN : `https://${process.env.UNIPILE_DSN}`,
        expiresOn,
        name: flow.user_id,
        success_redirect_url: publicUrl(req, `/api/connect/linkedin/claim?s=${encodeURIComponent(state)}`).toString(),
        failure_redirect_url: publicUrl(req, '/connect/done?provider=linkedin&ok=0&reason=' + encodeURIComponent('LinkedIn was not connected')).toString(),
      },
    });
    const url = (res.url ?? res.link) as string | undefined;
    if (res.error || !url) throw new Error(String(res.error || 'no hosted link'));
    return NextResponse.redirect(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed';
    await sendTelegram(flow.telegram_chat_id, `❌ I could not start the ${flow.provider} connection (${msg.slice(0, 120)}). Ask me for a new link in a minute.`);
    return NextResponse.redirect(publicUrl(req, '/connect/done?ok=0&reason=' + encodeURIComponent('Could not start the connection. Try again from Telegram.')));
  }
}
