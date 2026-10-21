/**
 * Exchange a Google OAuth code and store the tokens for a person. Shared by the browser callback and the
 * Telegram connect flow. Server-only.
 */
import pool from '@/lib/db';
import { exchangeCodeForToken, getGoogleUserEmail } from '@/lib/google-oauth';

export async function storeGoogleTokens(userId: string, code: string, provider: 'google' | 'gmail_send' = 'google'): Promise<{ email: string | null }> {
  const tokens = await exchangeCodeForToken(code);
  const email = await getGoogleUserEmail(tokens.access_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const scopes = provider === 'gmail_send' ? ['email', 'gmail.send', 'gmail.readonly'] : ['email', 'contacts.readonly', 'gmail.readonly'];
  await pool.query(
    `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, scopes, account_email)
     VALUES ($1, $7, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, provider) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
       expires_at = EXCLUDED.expires_at,
       scopes = EXCLUDED.scopes,
       account_email = EXCLUDED.account_email,
       updated_at = now()`,
    [userId, tokens.access_token, tokens.refresh_token || null, expiresAt, scopes, email, provider]
  );
  if (provider === 'gmail_send' && email) {
    // The sending mailbox (core 076): one per person; reconnecting revives it.
    await pool.query(
      `INSERT INTO email_senders (user_id, address, display_name)
       VALUES ($1, $2, (SELECT name FROM users WHERE id = $1))
       ON CONFLICT (user_id) DO UPDATE SET address = EXCLUDED.address, revoked_at = NULL, last_error = NULL,
         connected_at = CASE WHEN email_senders.revoked_at IS NOT NULL THEN now() ELSE email_senders.connected_at END,
         updated_at = now()`,
      [userId, email.toLowerCase()],
    );
  }
  return { email };
}
