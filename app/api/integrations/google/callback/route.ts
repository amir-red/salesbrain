import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { publicUrl } from '@/lib/public-url';
import { verifyState } from '@/lib/signed-state';
import { completeFlow, getOpenFlow } from '@/lib/connect-tokens';
import { storeGoogleTokens } from '@/lib/google-connect';
import { runGoogleSync } from '@/lib/google-sync';
import { sendTelegram } from '@/lib/tg-notify';

/**
 * Google OAuth callback. Two ways in, one verified `state`:
 *  - the browser (Profile → Imports): the cookie session must be the user named in the state;
 *  - a link the Telegram bot gave out (`state.t` names an open row in connect_tokens): there is no browser
 *    session on a phone, the signed state + the still-open token are the proof, and the result is reported
 *    back in the chat (then the person's contacts are imported in the background).
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  const st = verifyState<{ uid: string; t?: string }>(req.nextUrl.searchParams.get('state'));

  const done = (ok: boolean, reason?: string) =>
    publicUrl(req, `/connect/done?provider=google&ok=${ok ? 1 : 0}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`);

  // ── Telegram flow ───────────────────────────────────────────────
  if (st?.t) {
    const flow = await getOpenFlow(st.t, 'google');
    if (!flow || flow.user_id !== st.uid) {
      return NextResponse.redirect(done(false, 'This link has expired or was already used. Ask the bot for a new one.'));
    }
    if (error || !code) {
      await completeFlow(flow.id, `failed: ${error || 'no code'}`);
      await sendTelegram(flow.telegram_chat_id, `❌ Google was not connected (${error || 'no approval received'}). Ask me to connect Google again for a new link.`);
      return NextResponse.redirect(done(false, error || 'not approved'));
    }
    try {
      const { email } = await storeGoogleTokens(flow.user_id, code);
      await completeFlow(flow.id, 'connected');
      await sendTelegram(flow.telegram_chat_id, `✅ Google connected${email ? ` (${email})` : ''}. I'm importing your contacts now and will tell you when it is done.`);
      // Background: a large address book takes minutes; the browser must not wait for it.
      void runGoogleSync(flow.user_id, { mode: 'contacts' })
        .then((out) => sendTelegram(flow.telegram_chat_id,
          'error' in out ? `⚠️ Google is connected but the import did not run: ${out.error}`
            : `📇 Google import finished: ${out.contacts_imported} new contact${out.contacts_imported === 1 ? '' : 's'}`
              + `${out.errors ? ` (${out.errors} problem${out.errors === 1 ? '' : 's'}, e.g. ${out.error_messages[0] ?? ''})` : ''}. `
              + 'Ask me to pull Gmail history for your leads whenever you like.'))
        .catch(() => undefined);
      return NextResponse.redirect(done(true));
    } catch (err) {
      console.error('[Google OAuth callback · telegram]', err);
      // Google's error body is JSON with newlines: one short readable line, never the raw blob, goes to the person.
      const msg = (err instanceof Error ? err.message : 'exchange_failed').replace(/\s+/g, ' ').slice(0, 140);
      await completeFlow(flow.id, `failed: ${msg}`);
      await sendTelegram(flow.telegram_chat_id, `❌ Google was not connected: ${msg}. Ask me for a new link to try again.`);
      return NextResponse.redirect(done(false, msg));
    }
  }

  // ── Browser flow ────────────────────────────────────────────────
  const session = await getSession();
  if (!session) return NextResponse.redirect(publicUrl(req, '/login'));
  if (error) return NextResponse.redirect(publicUrl(req, `/profile?tab=imports&error=${encodeURIComponent(error)}`));
  if (!code) return NextResponse.redirect(publicUrl(req, '/profile?tab=imports&error=missing_code'));
  if (!st || st.uid !== session.userId) {
    return NextResponse.redirect(publicUrl(req, '/profile?tab=imports&error=invalid_state'));
  }
  try {
    await storeGoogleTokens(session.userId, code);
    return NextResponse.redirect(publicUrl(req, '/profile?tab=imports&connected=google'));
  } catch (err) {
    console.error('[Google OAuth callback]', err);
    return NextResponse.redirect(
      publicUrl(req, `/profile?tab=imports&error=${encodeURIComponent(err instanceof Error ? err.message : 'exchange_failed')}`)
    );
  }
}
