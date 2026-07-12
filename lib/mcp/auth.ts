/**
 * MCP request authentication + per-token rate limiting.
 *
 * Every MCP request goes through `authenticateRequest`:
 *   1. Pull the raw token from the `Authorization: Bearer …` header
 *   2. Look it up in `mcp_tokens` (SHA-256 → user_id + role)
 *   3. Enforce a per-token rolling rate limit (100 req/min default)
 *   4. Return an `AuthContext` the handler passes to tool dispatch
 *
 * Rate limiting is in-process only. Per-token — one busy token can't
 * starve another. Resets on server restart (acceptable — we're not
 * providing SLA guarantees on limit windows, just runaway protection).
 */

import type { NextRequest } from 'next/server';
import { lookupToken, type TokenLookupResult } from './tokens';

// ─── Types ─────────────────────────────────────────────────────────

export interface AuthContext {
  token_id: string;
  user_id: string;
  user_email: string;
  user_role: string;
  user_name: string;
  is_admin: boolean;
}

export type AuthResult =
  | { ok: true; ctx: AuthContext }
  | { ok: false; status: 401 | 429; error: string };

// ─── Header parsing ────────────────────────────────────────────────

function extractBearer(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// ─── Per-token rate limiter (in-process, sliding window) ─────────

const WINDOW_MS = 60 * 1000;
const DEFAULT_LIMIT = 100;
// Aggressive per-tool limits — some tools shouldn't be spammable at 100/min.
// Applied on top of the token limit in tool-dispatch.ts.
export const PER_TOOL_LIMITS: Record<string, number> = {
  send_telegram: 10,   // 10/hour = ~0.17/min average; use 10/min ceiling here
  send_email: 20,
};

// Map<tokenId, number[]> — timestamps of requests within the last WINDOW_MS.
const buckets = new Map<string, number[]>();

/** Prune expired entries from a bucket and return whether the new request fits. */
function checkAndRecord(tokenId: string, limit: number): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const bucket = buckets.get(tokenId) ?? [];
  // Drop timestamps outside the window (cheap since bucket is small + sorted).
  const fresh = bucket.filter((ts) => ts > cutoff);
  if (fresh.length >= limit) {
    // Persist the pruned bucket to keep memory bounded.
    buckets.set(tokenId, fresh);
    return false;
  }
  fresh.push(now);
  buckets.set(tokenId, fresh);
  return true;
}

/** Public helper for tool-dispatch to enforce per-tool sub-limits. */
export function enforceToolLimit(tokenId: string, toolName: string): boolean {
  const perToolLimit = PER_TOOL_LIMITS[toolName];
  if (perToolLimit === undefined) return true;   // no sub-limit for this tool
  const key = `${tokenId}::${toolName}`;
  return checkAndRecord(key, perToolLimit);
}

// ─── The main entry point ─────────────────────────────────────────

/**
 * Validate a request's Authorization header and rate-limit the caller.
 *
 * Never throws. Returns a discriminated union so the caller can pick
 * the right HTTP status without another lookup.
 */
export async function authenticateRequest(req: NextRequest): Promise<AuthResult> {
  const rawToken = extractBearer(req);
  if (!rawToken) return { ok: false, status: 401, error: 'Missing bearer token' };

  const result = await lookupToken(rawToken);
  if (!result) return { ok: false, status: 401, error: 'Invalid or revoked token' };

  const allowed = checkAndRecord(result.token_id, DEFAULT_LIMIT);
  if (!allowed) {
    return {
      ok: false,
      status: 429,
      error: `Rate limit exceeded (${DEFAULT_LIMIT} requests/min per token)`,
    };
  }

  return {
    ok: true,
    ctx: buildContext(result),
  };
}

function buildContext(t: TokenLookupResult): AuthContext {
  return {
    token_id: t.token_id,
    user_id: t.user_id,
    user_email: t.user_email,
    user_role: t.user_role,
    user_name: t.user_name,
    is_admin: t.user_role === 'admin',
  };
}
