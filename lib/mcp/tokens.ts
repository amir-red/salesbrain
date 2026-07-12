/**
 * MCP token lifecycle helpers.
 *
 * Design:
 *   - Raw tokens are 32-byte random base64url strings prefixed with `mcp_`
 *     for easy grep-ability in logs / password managers.
 *   - We NEVER store the raw token. Only SHA-256 hex is persisted in
 *     `mcp_tokens.token_hash`. If the DB is compromised, an attacker
 *     can't replay any token.
 *   - We DO store the first 8 chars (`token_prefix`) so the settings UI
 *     can show "mcp_a1b2..." for user recognition without leaking the
 *     secret.
 *   - Tokens are per-user. There's no cross-user token creation — the
 *     only way to make a token for user X is to be logged in as X.
 *   - Revocation is soft (sets `revoked_at`), so audit-log rows can still
 *     resolve `token_id`.
 */

import crypto from 'crypto';
import pool from '../db';

// ─── Token shape + generation ─────────────────────────────────────

const RAW_PREFIX = 'mcp_';
const RAW_ENTROPY_BYTES = 32;      // 256 bits — well above brute-force ceiling
const DISPLAY_PREFIX_LEN = 8;      // "mcp_a1b2" — enough to distinguish tokens

/**
 * Generate a fresh raw token. Format: `mcp_` + base64url(32 random bytes).
 * Base64url is URL-safe (no +/=) and slightly denser than hex.
 */
export function generateRawToken(): string {
  return RAW_PREFIX + crypto.randomBytes(RAW_ENTROPY_BYTES).toString('base64url');
}

/**
 * SHA-256 hex of the raw token — what we actually store.
 * Constant-time comparison happens at lookup (single indexed lookup, so
 * no timing side channel from the hash step itself).
 */
export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** First 8 chars of the raw token, safe for display. */
export function tokenPrefix(raw: string): string {
  return raw.slice(0, DISPLAY_PREFIX_LEN);
}

// ─── Public API surface ───────────────────────────────────────────

export interface McpToken {
  id: string;
  user_id: string;
  token_prefix: string;
  name: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/**
 * Create a new token for the given user. Returns the RAW token (shown to
 * the user once) alongside the row. Caller MUST show the raw value to the
 * user and never persist it.
 */
export async function createToken(
  userId: string,
  name: string,
): Promise<{ raw: string; row: McpToken }> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error('Token name is required');
  if (trimmedName.length > 100) throw new Error('Token name too long (max 100 chars)');

  const raw = generateRawToken();
  const hash = hashToken(raw);
  const prefix = tokenPrefix(raw);

  const { rows } = await pool.query<McpToken>(
    `INSERT INTO mcp_tokens (user_id, token_hash, token_prefix, name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, token_prefix, name, last_used_at, revoked_at, created_at`,
    [userId, hash, prefix, trimmedName],
  );
  return { raw, row: rows[0] };
}

/**
 * List a user's active (non-revoked) tokens. Sorted newest-first for the UI.
 */
export async function listUserTokens(userId: string): Promise<McpToken[]> {
  const { rows } = await pool.query<McpToken>(
    `SELECT id, user_id, token_prefix, name, last_used_at, revoked_at, created_at
     FROM mcp_tokens
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [userId],
  );
  return rows;
}

/**
 * Soft-revoke a token. The revoke is scoped to the calling user — a user
 * can only revoke their own tokens. Returns true iff a row was updated.
 */
export async function revokeToken(tokenId: string, userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE mcp_tokens
     SET revoked_at = now()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [tokenId, userId],
  );
  return (rowCount ?? 0) > 0;
}

// ─── Lookup used by auth.ts on every request ──────────────────────

export interface TokenLookupResult {
  token_id: string;
  user_id: string;
  user_email: string;
  user_role: string;
  user_name: string;
}

/**
 * Resolve a raw bearer token to its owning user. Returns null if the token
 * is unknown, revoked, or malformed. Called on every MCP request — must
 * be fast (single indexed lookup on `token_hash`).
 *
 * Side effect: updates `last_used_at` fire-and-forget. Failure to update
 * doesn't fail the auth (rare, non-critical, would just show stale
 * "last used" in the settings UI).
 */
export async function lookupToken(rawToken: string | null | undefined): Promise<TokenLookupResult | null> {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const trimmed = rawToken.trim();
  if (!trimmed.startsWith(RAW_PREFIX)) return null;

  const hash = hashToken(trimmed);

  const { rows } = await pool.query<TokenLookupResult>(
    `SELECT t.id AS token_id, u.id AS user_id, u.email AS user_email,
            COALESCE(u.role, 'user') AS user_role, u.name AS user_name
     FROM mcp_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1 AND t.revoked_at IS NULL
     LIMIT 1`,
    [hash],
  );

  if (rows.length === 0) return null;

  // Fire-and-forget last_used bump. Don't await — auth path is hot.
  pool.query(`UPDATE mcp_tokens SET last_used_at = now() WHERE id = $1`, [rows[0].token_id])
    .catch((err) => console.warn('[mcp/tokens] last_used_at update failed:', err));

  return rows[0];
}
