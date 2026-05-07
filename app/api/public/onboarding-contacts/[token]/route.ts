import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import pool from '@/lib/db';

/**
 * Token-protected, UNAUTHENTICATED endpoints for the Stage-2 client form.
 * The token itself is the auth — no session needed. Atomic single-use validation
 * mirrors app/api/auth/reset-password/route.ts.
 */

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

/**
 * GET /api/public/onboarding-contacts/[token]
 * Returns the onboarding's company name so the form can prefill its header.
 * Does NOT return any prior contact data (write-only endpoint from the client side).
 */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const result = await lookupToken(params.token);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ company_name: result.data.company_name });
}

const SubmitSchema = z.object({
  executive_name: z.string().min(1).max(255),
  executive_email: z.string().email(),
  executive_role: z.string().max(255).optional(),
  project_manager_name: z.string().min(1).max(255),
  project_manager_email: z.string().email(),
  it_admin_name: z.string().min(1).max(255),
  it_admin_email: z.string().email(),
});

/**
 * POST /api/public/onboarding-contacts/[token]
 * Writes the 3 contacts to the bound onboarding row, marks the token used,
 * and (if all 3 are filled and onboarding is currently at Stage 2) advances to Stage 3.
 *
 * Single-use enforcement: WHERE used_at IS NULL on the UPDATE prevents races.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = SubmitSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message || 'Invalid input';
    return NextResponse.json({ error: first }, { status: 400 });
  }
  const d = parsed.data;

  const result = await lookupToken(params.token);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
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
      return NextResponse.json({ error: 'This link has already been used' }, { status: 410 });
    }

    // Should we advance? Only if currently sitting at stage 2.
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
    console.error('[public onboarding-contacts] Submit failed:', err);
    return NextResponse.json({ error: 'Could not save contacts. Try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
