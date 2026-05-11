import { NextRequest } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import pool from '@/lib/db';
import { requireApiKey, jsonWithCors, corsOptions } from '@/lib/public-api';

/**
 * Token-protected, UNAUTHENTICATED-by-session endpoints for the Stage-2
 * client onboarding form.
 *
 * Two-layer auth:
 *   1. **API key** — see lib/public-api.ts. Gates *who* can call.
 *   2. **Per-link token** (path param) — gates *which* onboarding row this
 *      caller may read/write. Atomic single-use validation mirrors
 *      app/api/auth/reset-password/route.ts.
 */

export function OPTIONS(req: NextRequest) {
  return corsOptions(req);
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
  // Editable Stage-1 / company fields exposed to the client form
  company_name: string;
  website: string | null;
  company_size: string | null;
  description: string | null;
  deployment_plan: 'on_premise' | 'saas_cloud' | null;
  primary_contact_email: string | null;
  // Onboarding progress (used to render the timeline UI on the client side)
  current_stage: number;
  status: 'in_progress' | 'completed' | 'paused';
  stage1_completed_at: string | null;
  stage2_completed_at: string | null;
  stage3_completed_at: string | null;
  stage4_completed_at: string | null;
  stage5_completed_at: string | null;
  stage6_completed_at: string | null;
  stage7_completed_at: string | null;
  stage8_completed_at: string | null;
}

/**
 * Lookup with two modes:
 *   - mode='read'  → reject only on expiry. Used by GET so the client can
 *                    keep checking progress on the same link AFTER submitting.
 *   - mode='write' → reject on expiry OR used_at. Used by POST to keep the
 *                    submission single-use.
 */
async function lookupToken(
  rawToken: string,
  mode: 'read' | 'write' = 'read',
): Promise<{ ok: true; data: TokenRecord } | { ok: false; status: number; error: string }> {
  if (!rawToken || rawToken.length < 10) return { ok: false, status: 400, error: 'Invalid token' };
  const tokenHash = hashToken(rawToken);
  const { rows } = await pool.query(
    `SELECT l.id, l.onboarding_id, l.expires_at, l.used_at,
            o.company_name, o.website, o.company_size, o.description,
            o.deployment_plan, o.primary_contact_email,
            o.stage as current_stage, o.status,
            o.stage1_completed_at, o.stage2_completed_at, o.stage3_completed_at,
            o.stage4_completed_at, o.stage5_completed_at, o.stage6_completed_at,
            o.stage7_completed_at, o.stage8_completed_at
     FROM onboarding_form_links l
     JOIN client_onboardings o ON o.id = l.onboarding_id
     WHERE l.token_hash = $1 LIMIT 1`,
    [tokenHash]
  );
  const r = rows[0];
  if (!r) return { ok: false, status: 404, error: 'Invalid or unknown link' };
  if (new Date(r.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 410, error: 'This link has expired' };
  }
  if (mode === 'write' && r.used_at) {
    return { ok: false, status: 410, error: 'This link has already been used' };
  }
  return { ok: true, data: r as TokenRecord };
}

// ─── GET: prefill ───────────────────────────────────────────────────────────

/**
 * GET /api/public/onboarding/[token]
 *
 * Returns BOTH prefill values (for the form) AND live progress (for the
 * timeline). Works for the same token before AND after submission — once
 * the client has filled the form, the same link continues to return live
 * stage updates so they can keep an eye on where their onboarding is at.
 *
 * The 3 contact-role fields (executive / project manager / IT admin) are
 * INTENTIONALLY NOT returned — write-only from the client side. Prevents a
 * stale browser tab from leaking who was previously submitted.
 */
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const denial = requireApiKey(req);
  if (denial) return denial;

  const result = await lookupToken(params.token, 'read');
  if (!result.ok) return jsonWithCors(req, { error: result.error }, result.status);
  const d = result.data;
  return jsonWithCors(req, {
    // Editable / prefill fields
    company_name: d.company_name,
    website: d.website,
    company_size: d.company_size,
    description: d.description,
    deployment_plan: d.deployment_plan,
    primary_contact_email: d.primary_contact_email,
    // Token meta
    expires_at: d.expires_at,
    submitted_at: d.used_at,             // null until the form is submitted
    // Live progress — drives the client-side timeline / status UI
    stage: d.current_stage,
    status: d.status,
    stage_completions: {
      stage1: d.stage1_completed_at,
      stage2: d.stage2_completed_at,
      stage3: d.stage3_completed_at,
      stage4: d.stage4_completed_at,
      stage5: d.stage5_completed_at,
      stage6: d.stage6_completed_at,
      stage7: d.stage7_completed_at,
      stage8: d.stage8_completed_at,
    },
  });
}

// ─── POST: submit ───────────────────────────────────────────────────────────

const SubmitSchema = z.object({
  // 3 role contacts (required — primary purpose of the form)
  executive_name: z.string().min(1).max(255),
  executive_email: z.string().email(),
  executive_role: z.string().max(255).optional(),
  project_manager_name: z.string().min(1).max(255),
  project_manager_email: z.string().email(),
  it_admin_name: z.string().min(1).max(255),
  it_admin_email: z.string().email(),
  // Stage-1 / company-profile fields (optional — client may confirm or correct)
  website: z.string().max(512).nullable().optional(),
  company_size: z.string().max(64).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  deployment_plan: z.enum(['on_premise', 'saas_cloud']).nullable().optional(),
  primary_contact_email: z.union([z.string().email(), z.literal('')]).nullable().optional(),
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

  const result = await lookupToken(params.token, 'write');
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

    // Build the UPDATE dynamically. Required role-contact fields always set;
    // optional company-profile fields only when present in the body so the
    // client can leave them blank without nulling existing values.
    const sets: string[] = [
      'executive_name = $1', 'executive_email = $2', 'executive_role = $3',
      'project_manager_name = $4', 'project_manager_email = $5',
      'it_admin_name = $6', 'it_admin_email = $7',
    ];
    const params: unknown[] = [
      d.executive_name, d.executive_email, d.executive_role || null,
      d.project_manager_name, d.project_manager_email,
      d.it_admin_name, d.it_admin_email,
    ];
    let nextIdx = 8;
    const addOptional = (col: string, val: unknown) => {
      if (val !== undefined) {
        sets.push(`${col} = $${nextIdx++}`);
        params.push(val);
      }
    };
    // empty-string emails → null so we never persist ''
    const normEmail = (v: string | null | undefined) =>
      v === undefined ? undefined : v === '' ? null : v;
    addOptional('website',               d.website);
    addOptional('company_size',          d.company_size);
    addOptional('description',           d.description);
    addOptional('deployment_plan',       d.deployment_plan);
    addOptional('primary_contact_email', normEmail(d.primary_contact_email));

    if (advance) sets.push(`stage = 3, stage2_completed_at = COALESCE(stage2_completed_at, now())`);

    params.push(onboarding_id);
    await pool.query(
      `UPDATE client_onboardings SET ${sets.join(', ')} WHERE id = $${nextIdx}`,
      params
    );

    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('[public onboarding] Submit failed:', err);
    return jsonWithCors(req, { error: 'Could not save contacts. Try again.' }, 500);
  }

  return jsonWithCors(req, { ok: true });
}
