/**
 * The app half of the one-time connect links the bot mints (core migration 066, `connect_tokens`).
 * The bot stores only a SHA-256 hash; opening the link consumes it (`used_at`), and the flow it starts is
 * finished exactly once (`completed_at`). Server-only.
 */
import crypto from 'crypto';
import pool from './db';

export interface ConnectFlow {
  id: string;
  user_id: string;
  provider: 'google' | 'linkedin';
  telegram_chat_id: string | null;
}

/** Open a link: valid, unexpired, never opened, never finished → marked opened and returned. */
export async function openConnectToken(raw: string): Promise<ConnectFlow | null> {
  if (!raw || raw.length < 20 || raw.length > 200) return null;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const { rows } = await pool.query<ConnectFlow>(
    `UPDATE connect_tokens SET used_at = now()
      WHERE token_hash = $1 AND used_at IS NULL AND completed_at IS NULL AND expires_at > now()
      RETURNING id, user_id, provider, telegram_chat_id`,
    [hash]
  );
  return rows[0] ?? null;
}

/**
 * The flow behind a signed state, if it is still open. Opening a link starts the clock for the consent step,
 * so a flow may finish up to ten minutes after the link itself would have expired.
 */
export async function getOpenFlow(id: string, provider: 'google' | 'linkedin'): Promise<ConnectFlow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await pool.query<ConnectFlow>(
    `SELECT id, user_id, provider, telegram_chat_id FROM connect_tokens
      WHERE id = $1 AND provider = $2 AND used_at IS NOT NULL AND completed_at IS NULL
        AND expires_at + interval '10 minutes' > now()`,
    [id, provider]
  );
  return rows[0] ?? null;
}

export async function completeFlow(id: string, outcome: string): Promise<void> {
  await pool.query(`UPDATE connect_tokens SET completed_at = now(), outcome = $2 WHERE id = $1 AND completed_at IS NULL`, [id, outcome.slice(0, 200)]);
}
