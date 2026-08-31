/**
 * Service-token lifecycle for the outreach-as-a-service MCP surface.
 *
 * Unlike lib/mcp/tokens.ts (per-USER tokens), these authenticate a whole
 * sibling APP. One token per consuming app; the app then asserts WHICH of its
 * employees a call acts for via the X-On-Behalf-Of header (see identity.ts).
 *
 * Same hygiene as MCP tokens: raw is shown once, only the SHA-256 is stored,
 * a display prefix is kept for recognition, revocation is soft.
 */

import crypto from 'crypto';
import pool from '../db';

const RAW_PREFIX = 'svc_';
const RAW_ENTROPY_BYTES = 32;       // 256 bits
const DISPLAY_PREFIX_LEN = 12;      // "svc_a1b2c3d4"

export function generateRawToken(): string {
  return RAW_PREFIX + crypto.randomBytes(RAW_ENTROPY_BYTES).toString('base64url');
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function tokenPrefix(raw: string): string {
  return raw.slice(0, DISPLAY_PREFIX_LEN);
}

export interface ServiceToken {
  id: string;
  app_key: string;
  token_prefix: string;
  name: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/**
 * Mint a token for an app. Returns the RAW token (shown once) + the row.
 * app_key is the namespace for that app's employee ids.
 */
export async function createServiceToken(
  appKey: string,
  name: string,
): Promise<{ raw: string; row: ServiceToken }> {
  const app = appKey.trim();
  const label = name.trim();
  if (!app) throw new Error('app_key is required');
  if (!label) throw new Error('Token name is required');
  if (app.length > 64) throw new Error('app_key too long (max 64 chars)');
  if (label.length > 100) throw new Error('Token name too long (max 100 chars)');

  const raw = generateRawToken();
  const { rows } = await pool.query<ServiceToken>(
    `INSERT INTO service_tokens (app_key, token_hash, token_prefix, name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, app_key, token_prefix, name, last_used_at, revoked_at, created_at`,
    [app, hashToken(raw), tokenPrefix(raw), label],
  );
  return { raw, row: rows[0] };
}

export async function listServiceTokens(): Promise<ServiceToken[]> {
  const { rows } = await pool.query<ServiceToken>(
    `SELECT id, app_key, token_prefix, name, last_used_at, revoked_at, created_at
     FROM service_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC`,
  );
  return rows;
}

export async function revokeServiceToken(tokenId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE service_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
    [tokenId],
  );
  return (rowCount ?? 0) > 0;
}

export interface ServiceTokenLookup {
  token_id: string;
  app_key: string;
}

/**
 * Resolve a raw bearer token to its app. Returns null if unknown/revoked/
 * malformed. Called on every request — single indexed lookup on token_hash.
 * Bumps last_used_at fire-and-forget.
 */
export async function lookupServiceToken(
  rawToken: string | null | undefined,
): Promise<ServiceTokenLookup | null> {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const trimmed = rawToken.trim();
  if (!trimmed.startsWith(RAW_PREFIX)) return null;

  const { rows } = await pool.query<ServiceTokenLookup>(
    `SELECT id AS token_id, app_key FROM service_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL LIMIT 1`,
    [hashToken(trimmed)],
  );
  if (rows.length === 0) return null;

  pool.query(`UPDATE service_tokens SET last_used_at = now() WHERE id = $1`, [rows[0].token_id])
    .catch((err) => console.warn('[service-mcp/tokens] last_used_at update failed:', err));

  return rows[0];
}
