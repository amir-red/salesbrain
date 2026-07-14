/**
 * Telegram user-linking helpers — per-user account binding + one-time
 * linking tokens. Design mirrors `lib/mcp/tokens.ts` (hashed storage,
 * single-use, revokable).
 *
 * Flow:
 *   1. User visits /settings/telegram → generateLinkToken(userId) returns
 *      a raw code like "LINK-A1B2C3".
 *   2. User sends `/start LINK-A1B2C3` to the bot.
 *   3. Bot calls `consumeLinkToken(rawCode, telegramUserId, ...)` which:
 *      - validates the token isn't expired or used
 *      - creates a telegram_user_links row (INSERT ... ON CONFLICT for
 *        the case where the user re-links from a different Telegram
 *        account without revoking first)
 *      - marks the token as used
 * 4. Subsequent messages: `lookupTelegramLink(telegramUserId)` finds the
 *    linked SalesBrain user.
 */

import crypto from 'crypto';
import pool from './db';

// ─── Constants ────────────────────────────────────────────────────

const TOKEN_PREFIX = 'LINK-';
// 6 chars of base32 = ~30 bits of entropy. Enough for one-time codes
// with 15-min TTL (a brute-force attacker has one guess per token before
// expiry — bounded even ignoring rate limits).
const TOKEN_BODY_LEN = 6;
const TOKEN_TTL_MS = 15 * 60 * 1000;

// RFC 4648 base32 alphabet, excluding easily confused chars (0/O, 1/I/L).
const BASE32_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// ─── Token generation + hashing ───────────────────────────────────

function randomBase32(len: number): string {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += BASE32_ALPHABET[bytes[i] % BASE32_ALPHABET.length];
  return out;
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ─── Types ────────────────────────────────────────────────────────

export interface TelegramLinkToken {
  id: string;
  user_id: string;
  token_prefix: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface TelegramLink {
  id: string;
  user_id: string;
  telegram_user_id: string;      // Bigint returned as string by pg driver
  telegram_chat_id: string;
  telegram_username: string | null;
  telegram_first_name: string | null;
  telegram_last_name: string | null;
  linked_at: string;
}

// ─── Public API — link tokens ─────────────────────────────────────

/**
 * Generate a new link token for the given SalesBrain user. Returns the RAW
 * code (shown to the user once in the settings UI). Prior pending tokens
 * for the same user are revoked automatically — only one active at a time.
 */
export async function generateLinkToken(userId: string): Promise<{ raw: string; row: TelegramLinkToken }> {
  const raw = TOKEN_PREFIX + randomBase32(TOKEN_BODY_LEN);
  const hash = hashToken(raw);
  const prefix = raw.slice(0, TOKEN_PREFIX.length + 2);   // e.g. "LINK-A1"
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  // Invalidate any existing pending tokens for this user so only one code
  // is valid at a time. Prevents confusion when a user hits "generate" twice.
  await pool.query(
    `UPDATE telegram_link_tokens
     SET used_at = now(), used_by_telegram_id = 0
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );

  const { rows } = await pool.query<TelegramLinkToken>(
    `INSERT INTO telegram_link_tokens (user_id, token_hash, token_prefix, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, token_prefix, expires_at, used_at, created_at`,
    [userId, hash, prefix, expiresAt],
  );

  return { raw, row: rows[0] };
}

/**
 * Attempt to consume a link token: validates + marks used + creates the
 * telegram_user_links row atomically. Returns the resulting link on success,
 * or an error string.
 */
export async function consumeLinkToken(
  rawToken: string,
  telegramInfo: {
    telegram_user_id: number | string;
    telegram_chat_id: number | string;
    telegram_username?: string | null;
    telegram_first_name?: string | null;
    telegram_last_name?: string | null;
  },
): Promise<{ ok: true; link: TelegramLink; user_id: string } | { ok: false; reason: string }> {
  const trimmed = String(rawToken).trim().toUpperCase();
  if (!trimmed.startsWith(TOKEN_PREFIX)) return { ok: false, reason: 'Token must start with LINK-' };
  const hash = hashToken(trimmed);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Atomically mark the token as used and return the associated user.
    // If already used or expired, no rows come back.
    const { rows: tokenRows } = await client.query<{ user_id: string }>(
      `UPDATE telegram_link_tokens
       SET used_at = now(), used_by_telegram_id = $2
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > now()
       RETURNING user_id`,
      [hash, String(telegramInfo.telegram_user_id)],
    );
    if (tokenRows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'Token is invalid, expired, or already used' };
    }
    const userId = tokenRows[0].user_id;

    // Revoke any existing active link for this user (they're re-linking).
    await client.query(
      `UPDATE telegram_user_links SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    // Also revoke any active link that this Telegram user_id already has
    // (they were linked to a different SalesBrain account).
    await client.query(
      `UPDATE telegram_user_links SET revoked_at = now()
       WHERE telegram_user_id = $1 AND revoked_at IS NULL`,
      [String(telegramInfo.telegram_user_id)],
    );

    // Create the new binding.
    const { rows: linkRows } = await client.query<TelegramLink>(
      `INSERT INTO telegram_user_links
        (user_id, telegram_user_id, telegram_chat_id,
         telegram_username, telegram_first_name, telegram_last_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, telegram_user_id::text, telegram_chat_id::text,
                 telegram_username, telegram_first_name, telegram_last_name, linked_at`,
      [
        userId,
        String(telegramInfo.telegram_user_id),
        String(telegramInfo.telegram_chat_id),
        telegramInfo.telegram_username || null,
        telegramInfo.telegram_first_name || null,
        telegramInfo.telegram_last_name || null,
      ],
    );

    await client.query('COMMIT');
    return { ok: true, link: linkRows[0], user_id: userId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Public API — link lookup / revocation ───────────────────────

/**
 * Find the SalesBrain user linked to a given Telegram user id. Called on
 * every incoming message from a private chat.
 */
export interface LinkedUser {
  user_id: string;
  user_email: string;
  user_name: string;
  user_role: string;
  telegram_chat_id: string;
  link_id: string;
}

export async function lookupTelegramLink(telegramUserId: number | string): Promise<LinkedUser | null> {
  const { rows } = await pool.query<LinkedUser>(
    `SELECT l.id AS link_id, l.user_id, u.email AS user_email, u.name AS user_name,
            COALESCE(u.role, 'user') AS user_role,
            l.telegram_chat_id::text AS telegram_chat_id
     FROM telegram_user_links l
     JOIN users u ON u.id = l.user_id
     WHERE l.telegram_user_id = $1 AND l.revoked_at IS NULL
     LIMIT 1`,
    [String(telegramUserId)],
  );
  return rows[0] || null;
}

export async function getCurrentLinkForUser(userId: string): Promise<TelegramLink | null> {
  const { rows } = await pool.query<TelegramLink>(
    `SELECT id, user_id, telegram_user_id::text, telegram_chat_id::text,
            telegram_username, telegram_first_name, telegram_last_name, linked_at
     FROM telegram_user_links
     WHERE user_id = $1 AND revoked_at IS NULL
     LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

export async function revokeLink(userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE telegram_user_links SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return (rowCount ?? 0) > 0;
}
