import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import pool from '@/lib/db';

/**
 * Token-protected, UNAUTHENTICATED-by-session endpoints for the Stage-2 client form.
 *
 * Two-layer auth:
 *   1. **API key** (`x-api-key` or `Authorization: Bearer …`) — gates *who* can
 *      call this endpoint at all. Set `ONBOARDING_API_KEY` in env. The form is
 *      hosted on zeami.io; zeami.io's backend stores the key and proxies the
 *      request. The salesbrain in-app form (dev fallback) is served by the
 *      same Next process so the call comes from `localhost`/the app origin —
 *      we exempt same-origin calls to keep the local form working.
 *
 *   2. **Per-link token** (path param) — gates *which* onboarding row this
 *      caller may read/write. Atomic single-use validation mirrors
 *      app/api/auth/reset-password/route.ts.
 *
 * Plus CORS so zeami.io can call cross-origin if it ever needs to.
 */

// ─── API-key check ──────────────────────────────────────────────────────────

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

/** True if the request originates from the same origin as the salesbrain
 *  app (the in-app dev fallback at /forms/onboarding/...). */
function isSameOriginRequest(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) {
    // No Origin header → same-origin GET (browser navigation) or curl. We
    // still accept this if there's a Referer pointing at the same host.
    const referer = req.headers.get('referer');
    if (!referer) return false;
    try {
      const refUrl = new URL(referer);
      const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
        || req.headers.get('host');
      return host !== null && refUrl.host === host;
    } catch { return false; }
  }
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    || req.headers.get('host');
  if (!host) return false;
  try {
    const o = new URL(origin);
    return o.host === host;
  } catch { return false; }
}

/**
 * Returns null if the request is authorized to use the public form API.
 * Otherwise returns a 401/403 response.
 *
 * Authorization rule:
 *   - If `ONBOARDING_API_KEY` is set: callers must present the matching key,
 *     OR be same-origin (in-app dev fallback form).
 *   - If unset: every caller is allowed (development convenience).
 */
function requireApiKey(req: NextRequest): NextResponse | null {
  const expected = process.env.ONBOARDING_API_KEY;
  if (!expected) return null;                                 // unconfigured = open
  if (isSameOriginRequest(req)) return null;                  // in-app form fallback
  const provided = extractApiKey(req);
  if (!provided) {
    return jsonWithCors(req, { error: 'Missing API key' }, 401);
  }
  if (!constantTimeEqual(provided, expected)) {
    return jsonWithCors(req, { error: 'Invalid API key' }, 403);
  }
  return null;
}

// ─── CORS ───────────────────────────────────────────────────────────────────

function corsHeaders(req: NextRequest): Record<string, string> {
  // Allow only the configured public-form origin (zeami.io). If it's unset,
  // mirror the request's Origin (development) — never use a permissive `*`
  // alongside credentials.
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

function jsonWithCors(req: NextRequest, body: unknown, status = 200): NextResponse {
  const res = NextResponse.json(body, { status });
  for (const [k, v] of Object.entries(corsHeaders(req))) res.headers.set(k, v);
  return res;
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

// ─── Token lookup (unchanged) ───────────────────────────────────────────────

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

interface TokenRecord {
  id: string;
  onboarding_id: string;
  expires_at: string;
  used_at: string | null;
  company_name: string;
  current_stage: number;
}

async function lookupToken(rawToken: string): Promise<{ ok: true; data: TokenRecord } | { ok: false; status: number; error: string }> {
  if (!rawToken || rawToken.length < 10) return { ok: false, status: 400, error: 'Invalid token' };
  const tokenHash = hashToken(rawToken);
  const { rows } = await pool.query(
    `SELECT l.id, l.onboarding_id, l.expires_at, l.used_at,
            o.company_name, o.stage as current_stage
     FROM onboarding_form_links l
     JOIN client_onboardings o ON o.id = l.onboarding_id
     WHERE l.token_hash = $1 LIMIT 1`,
    [tokenHash]
  );
  const r = rows[0];
  if (!r) return { ok: false, status: 404, error: 'Invalid or unknown link' };
  if (r.used_at) return { ok: false, status: 410, error: 'This link has already been used' };
  if (new Date(r.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 410, error: 'This link has expired' };
  }
  return { ok: true, data: r as TokenRecord };
}

// ─── GET: prefill ───────────────────────────────────────────────────────────

/**
 * GET /api/public/onboarding/[token]
 * Returns the onboarding's company name so the form can prefill its header.
 * Does NOT return any prior contact data (write-only from the client side).
 */
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const denial = requireApiKey(req);
  if (denial) return denial;

  const result = await lookupToken(params.token);
  if (!result.ok) return jsonWithCors(req, { error: result.error }, result.status);
  return jsonWithCors(req, { company_name: result.data.company_name });
}

// ─── POST: submit ───────────────────────────────────────────────────────────

const SubmitSchema = z.object({
  executive_name: z.string().min(1).max(255),
  executive_email: z.string().email(),
  executive_role: z.string().max(255).optional(),
  project_manager_name: z.string().min(1).max(255),
  project_manager_email: z.string().email(),
  it_admin_name: z.string().min(1).max(255),
  it_admin_email: z.string().email(),
});

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const denial = requireApiKey(req);
  if (denial) return denial;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonWithCors(req, { error: 'Invalid JSON' }, 400);
  }
  const parsed = SubmitSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message || 'Invalid input';
    return jsonWithCors(req, { error: first }, 400);
  }
  const d = parsed.data;

  const result = await lookupToken(params.token);
  if (!result.ok) return jsonWithCors(req, { error: result.error }, result.status);
  const { id: linkId, onboarding_id, current_stage } = result.data;

  // Atomic: claim the token, then write the contacts.
  await pool.query('BEGIN');
  try {
    const { rowCount } = await pool.query(
      `UPDATE onboarding_form_links SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
      [linkId]
    );
    if (!rowCount) {
      await pool.query('ROLLBACK');
      return jsonWithCors(req, { error: 'This link has already been used' }, 410);
    }

    const advance = current_stage === 2;

    await pool.query(
      `UPDATE client_onboardings SET
         executive_name = $1, executive_email = $2, executive_role = $3,
         project_manager_name = $4, project_manager_email = $5,
         it_admin_name = $6, it_admin_email = $7
         ${advance ? `, stage = 3, stage2_completed_at = COALESCE(stage2_completed_at, now())` : ''}
       WHERE id = $8`,
      [
        d.executive_name, d.executive_email, d.executive_role || null,
        d.project_manager_name, d.project_manager_email,
        d.it_admin_name, d.it_admin_email,
        onboarding_id,
      ]
    );

    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('[public onboarding] Submit failed:', err);
    return jsonWithCors(req, { error: 'Could not save contacts. Try again.' }, 500);
  }

  return jsonWithCors(req, { ok: true });
}
