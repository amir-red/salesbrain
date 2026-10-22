/**
 * Exchange a Google OAuth code and store the person's ONE Google connection (contacts, Gmail sync, sending). Shared by
 * the browser callback and the Telegram connect flow. Server-only.
 *
 * Sending: if Google granted gmail.send, the address becomes the person's sending mailbox (email_senders, core 076);
 * reconnecting without that permission switches sending off rather than leaving a mailbox that cannot send.
 */
import pool from '@/lib/db';
import { exchangeCodeForToken, getGoogleUserEmail, grantedScopes } from '@/lib/google-oauth';
import { watchMailbox } from '@/lib/gmail-send';

export async function storeGoogleTokens(userId: string, code: string): Promise<{ email: string | null; scopes: string[] }> {
  const tokens = await exchangeCodeForToken(code);
  const email = await getGoogleUserEmail(tokens.access_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const scopes = grantedScopes(tokens.scope);
  await pool.query(
    `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, scopes, account_email)
     VALUES ($1, 'google', $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, provider) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
       expires_at = EXCLUDED.expires_at,
       scopes = EXCLUDED.scopes,
       account_email = EXCLUDED.account_email,
       created_at = now(),   -- "connected at": a reconnect is a new connection; token refreshes only touch updated_at
       updated_at = now()`,
    [userId, tokens.access_token, tokens.refresh_token || null, expiresAt, scopes, email]
  );
  // The separate sending connection (provider 'gmail_send', 0.57–0.60) is folded into this one.
  await pool.query(`DELETE FROM oauth_tokens WHERE user_id = $1 AND provider = 'gmail_send'`, [userId]);
  if (email && scopes.includes('gmail.send')) {
    await pool.query(
      `INSERT INTO email_senders (user_id, address, display_name)
       VALUES ($1, $2, (SELECT name FROM users WHERE id = $1))
       ON CONFLICT (user_id) DO UPDATE SET address = EXCLUDED.address, revoked_at = NULL, last_error = NULL,
         connected_at = CASE WHEN email_senders.revoked_at IS NOT NULL THEN now() ELSE email_senders.connected_at END,
         updated_at = now()`,
      [userId, email.toLowerCase()],
    );
    // Replies to what this person sends are noticed in seconds (Gmail push) from now on, not at the next check.
    void watchMailbox(userId).catch(() => undefined);
  } else {
    await pool.query(`UPDATE email_senders SET revoked_at = now(), updated_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  }
  return { email, scopes };
}

/** Disconnect Google entirely: the token goes, and so does sending (approved emails wait for a reconnect). */
export async function disconnectGoogle(userId: string): Promise<void> {
  await pool.query(`DELETE FROM oauth_tokens WHERE user_id = $1 AND provider IN ('google', 'gmail_send')`, [userId]);
  await pool.query(`UPDATE email_senders SET revoked_at = now(), updated_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
}
