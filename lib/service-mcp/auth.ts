/**
 * Auth + rate limiting for the service MCP surface.
 *
 * Two-part identity:
 *   1. Authorization: Bearer <service token>  → which APP is calling.
 *   2. X-On-Behalf-Of: <employee_id>          → which of its users to act as.
 *
 * The app token is verified on every request; the employee is resolved to a
 * SalesBrain user id per tools/call (register_user is the one exception — it
 * establishes the mapping and needs no prior employee). Rate limiting is
 * in-process and per-app-token, mirroring lib/mcp/auth.ts.
 */

import type { NextRequest } from 'next/server';
import { lookupServiceToken } from './tokens';

export interface ServiceAuthContext {
  token_id: string;
  app_key: string;
}

export type ServiceAuthResult =
  | { ok: true; ctx: ServiceAuthContext }
  | { ok: false; status: 401 | 429; error: string };

function extractBearer(req: NextRequest): string | null {
  const h = req.headers.get('authorization');
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** Employee id the call acts on behalf of. Header or per-call arg both work. */
export function extractOnBehalfOf(req: NextRequest, args?: Record<string, unknown>): string | null {
  const header = req.headers.get('x-on-behalf-of');
  if (header && header.trim()) return header.trim();
  const arg = args?.employee_id;
  return typeof arg === 'string' && arg.trim() ? arg.trim() : null;
}

// ─── Per-token sliding-window rate limiter (in-process) ─────────────

const WINDOW_MS = 60 * 1000;
const DEFAULT_LIMIT = 120;   // requests/min per app token
const buckets = new Map<string, number[]>();

function checkAndRecord(key: string, limit: number): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const fresh = (buckets.get(key) ?? []).filter((ts) => ts > cutoff);
  if (fresh.length >= limit) {
    buckets.set(key, fresh);
    return false;
  }
  fresh.push(now);
  buckets.set(key, fresh);
  return true;
}

/**
 * Per-tool sub-limits — the same provider-quota-bound tools the MCP surface
 * throttles, keyed per (app token, tool). Returns false when the caller
 * should be told to slow down.
 */
const PER_TOOL_LIMITS: Record<string, number> = {
  crm_leads_finder_run: 5,
  crm_prospect_search: 5,
  crm_enrich_prospect: 20,
  crm_outreach_propose: 20,
  linkedin_connect_start: 10,
  suggest_icp: 20,          // one LLM call (+ maybe a site fetch) per invocation
};

export function enforceToolLimit(tokenId: string, toolName: string): boolean {
  const limit = PER_TOOL_LIMITS[toolName];
  if (limit === undefined) return true;
  return checkAndRecord(`${tokenId}::${toolName}`, limit);
}

export async function authenticateService(req: NextRequest): Promise<ServiceAuthResult> {
  const raw = extractBearer(req);
  if (!raw) return { ok: false, status: 401, error: 'Missing bearer token' };

  const found = await lookupServiceToken(raw);
  if (!found) return { ok: false, status: 401, error: 'Invalid or revoked service token' };

  if (!checkAndRecord(found.token_id, DEFAULT_LIMIT)) {
    return { ok: false, status: 429, error: `Rate limit exceeded (${DEFAULT_LIMIT} requests/min per token)` };
  }
  return { ok: true, ctx: { token_id: found.token_id, app_key: found.app_key } };
}
