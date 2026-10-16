/**
 * Exchange a Google OAuth code and store the tokens for a person. Shared by the browser callback and the
 * Telegram connect flow. Server-only.
 */
import pool from '@/lib/db';
import { exchangeCodeForToken, getGoogleUserEmail } from '@/lib/google-oauth';

export async function storeGoogleTokens(userId: string, code: string): Promise<{ email: string | null }> {
  const tokens = await exchangeCodeForToken(code);
  const email = await getGoogleUserEmail(tokens.access_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await pool.query(
    `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, scopes, account_email)
     VALUES ($1, 'google', $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, provider) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
       expires_at = EXCLUDED.expires_at,
       scopes = EXCLUDED.scopes,
       account_email = EXCLUDED.account_email,
       updated_at = now()`,
    [userId, tokens.access_token, tokens.refresh_token || null, expiresAt, ['email', 'contacts.readonly', 'gmail.readonly'], email]
  );
  return { email };
}
