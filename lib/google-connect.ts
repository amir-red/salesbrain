/**
 * Exchange a Google OAuth code and store ONE of the person's Google accounts (core 102: several per person — contacts,
 * Gmail into the Inbox, meetings, sending). Connecting an account again refreshes that account only. Shared by the
 * browser callback and the Telegram connect flow. Server-only.
 *
 * Sending: if Google granted gmail.send, the address becomes one of the person's sending mailboxes (email_senders); the
 * first one is their default. Reconnecting without that permission switches sending off for THAT mailbox.
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
     ON CONFLICT (user_id, provider, lower(COALESCE(account_email, ''))) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
       expires_at = EXCLUDED.expires_at,
       scopes = EXCLUDED.scopes,
       created_at = now(),   -- "connected at": a reconnect is a new connection; token refreshes only touch updated_at
       updated_at = now()`,
    [userId, tokens.access_token, tokens.refresh_token || null, expiresAt, scopes, email]
  );
  // The separate sending connection (provider 'gmail_send', 0.57–0.60) is folded into this one.
  await pool.query(`DELETE FROM oauth_tokens WHERE user_id = $1 AND provider = 'gmail_send'`, [userId]);
  if (email && scopes.includes('gmail.send')) {
    await pool.query(
      `INSERT INTO email_senders (user_id, address, display_name, is_default)
       VALUES ($1, $2, (SELECT name FROM users WHERE id = $1),
               NOT EXISTS (SELECT 1 FROM email_senders d WHERE d.user_id = $1 AND d.is_default AND d.revoked_at IS NULL
                             AND lower(d.address) <> lower($2)))
       ON CONFLICT (user_id, lower(address)) DO UPDATE SET revoked_at = NULL, last_error = NULL,
         is_default = email_senders.is_default OR EXCLUDED.is_default,
         connected_at = CASE WHEN email_senders.revoked_at IS NOT NULL THEN now() ELSE email_senders.connected_at END,
         updated_at = now()`,
      [userId, email.toLowerCase()],
    );
  } else if (email) {
    await pool.query(`UPDATE email_senders SET revoked_at = now(), is_default = false, updated_at = now()
                       WHERE user_id = $1 AND lower(address) = lower($2) AND revoked_at IS NULL`, [userId, email]);
    await promoteDefault(userId);
  }
  // Mail into the Inbox in seconds (Gmail push), for every account that can read mail, not only sending ones.
  if (email && scopes.includes('gmail.readonly')) void watchMailbox(userId, email).catch(() => undefined);
  return { email, scopes };
}

/** When a person's default sending mailbox goes, the next live one (oldest first) becomes the default. */
async function promoteDefault(userId: string): Promise<void> {
  await pool.query(
    `UPDATE email_senders SET is_default = true, updated_at = now()
      WHERE id = (SELECT id FROM email_senders WHERE user_id = $1 AND revoked_at IS NULL ORDER BY connected_at LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM email_senders WHERE user_id = $1 AND revoked_at IS NULL AND is_default)`, [userId]);
}

/**
 * Disconnect ONE Google account (`mailbox`), or all of them (no mailbox): its token goes, and so does sending from it
 * (approved emails from it wait for a reconnect). Conversations already in the Inbox stay.
 */
export async function disconnectGoogle(userId: string, mailbox?: string | null): Promise<void> {
  if (mailbox) {
    await pool.query(`DELETE FROM oauth_tokens WHERE user_id = $1 AND provider = 'google' AND lower(account_email) = lower($2)`, [userId, mailbox]);
    await pool.query(`UPDATE email_senders SET revoked_at = now(), is_default = false, updated_at = now()
                       WHERE user_id = $1 AND lower(address) = lower($2) AND revoked_at IS NULL`, [userId, mailbox]);
    await promoteDefault(userId);
    return;
  }
  await pool.query(`DELETE FROM oauth_tokens WHERE user_id = $1 AND provider IN ('google', 'gmail_send')`, [userId]);
  await pool.query(`UPDATE email_senders SET revoked_at = now(), is_default = false, updated_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
}
