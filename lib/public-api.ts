/**
 * Shared helpers for the `/api/public/*` server-to-server endpoints.
 *
 * Two-layer model:
 *   1. **API key** (`x-api-key` or `Authorization: Bearer …`) — gates *who*
 *      can call any of these endpoints at all. One shared secret across all
 *      public endpoints, set via `ONBOARDING_API_KEY` in env. (Name kept for
 *      backward-compat with the original onboarding integration; the same
 *      key now also gates the deal-info endpoint.)
 *   2. **Resource-level auth** — per-endpoint: e.g. the onboarding form uses
 *      a per-link token, the deal-info endpoint uses just the API key + a
 *      deal UUID. That logic lives in each route.
 *
 * Plus CORS so browsers on `PUBLIC_FORM_ALLOWED_ORIGIN` (typically zeami.io)
 * can call cross-origin if needed.
 *
 * Same-origin calls (the in-app dev fallback at /forms/onboarding) bypass
 * the API key — the request originates from the same Next process so the
 * key wouldn't be available anyway.
 */
import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

function extractApiKey(req: NextRequest): string | null {
  const headerKey = req.headers.get('x-api-key');
  if (headerKey) return headerKey.trim();
  const auth = req.headers.get('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function isSameOriginRequest(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    || req.headers.get('host');
  if (origin) {
    try {
      const o = new URL(origin);
      return host !== null && o.host === host;
    } catch { return false; }
  }
  // No Origin header → check Referer for same-host
  const referer = req.headers.get('referer');
  if (!referer) return false;
  try {
    const r = new URL(referer);
    return host !== null && r.host === host;
  } catch { return false; }
}

/**
 * Returns null if the request is authorized, otherwise a 401/403 response.
 * Rule: `ONBOARDING_API_KEY` env must be set in production; if unset (dev)
 * everything passes. Same-origin in-app callers always pass.
 */
export function requireApiKey(req: NextRequest): NextResponse | null {
  const expected = process.env.ONBOARDING_API_KEY;
  if (!expected) return null;
  if (isSameOriginRequest(req)) return null;
  const provided = extractApiKey(req);
  if (!provided) return jsonWithCors(req, { error: 'Missing API key' }, 401);
  if (!constantTimeEqual(provided, expected)) {
    return jsonWithCors(req, { error: 'Invalid API key' }, 403);
  }
  return null;
}

export function corsHeaders(req: NextRequest): Record<string, string> {
  const allowed = process.env.PUBLIC_FORM_ALLOWED_ORIGIN;
  const origin = req.headers.get('origin') ?? '';
  const allowOrigin = allowed || origin || '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Max-Age': '86400',
  };
}

export function jsonWithCors(req: NextRequest, body: unknown, status = 200): NextResponse {
  const res = NextResponse.json(body, { status });
  for (const [k, v] of Object.entries(corsHeaders(req))) res.headers.set(k, v);
  return res;
}

/** Standard CORS preflight handler — route files just re-export this. */
export function corsOptions(req: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}
