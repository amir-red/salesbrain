import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import pool from '@/lib/db';
import { sendEmail } from '@/lib/email';

const Schema = z.object({
  email: z.string().email(),
});

const TOKEN_TTL_HOURS = 1;
const RATE_LIMIT_MINUTES = 5;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getAppUrl(req: NextRequest): string {
  // Respect reverse-proxy headers so links work through Caddy
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.headers.get('host') || req.nextUrl.host;
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto = forwardedProto || req.nextUrl.protocol.replace(':', '') || 'https';
  return process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`;
}

/**
 * POST /api/auth/forgot-password
 * Always returns success (even if email not found) to prevent enumeration.
 * Rate-limited to one request per email per 5 minutes.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    // Don't leak validation details for enumeration protection — accept silently.
    return NextResponse.json({ ok: true });
  }

  const email = parsed.data.email.trim().toLowerCase();

  try {
    const { rows } = await pool.query(
      `SELECT id, name, email FROM users WHERE LOWER(email) = $1 LIMIT 1`,
      [email]
    );
    const user = rows[0];

    // No user found → respond success anyway
    if (!user) {
      return NextResponse.json({ ok: true });
    }

    // Rate limit: block if a reset was just requested
    const { rows: recentRows } = await pool.query(
      `SELECT created_at FROM password_resets
       WHERE user_id = $1 AND created_at > now() - interval '${RATE_LIMIT_MINUTES} minutes'
       ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );
    if (recentRows.length > 0) {
      // Silently succeed
      return NextResponse.json({ ok: true });
    }

    // Generate raw token (sent in email) + hash (stored in DB)
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 3600 * 1000);

    await pool.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );

    const appUrl = getAppUrl(req);
    const resetLink = `${appUrl}/reset-password?token=${rawToken}`;

    const subject = 'Reset your SalesBrain password';
    const bodyText = [
      `Hi ${user.name || ''},`,
      '',
      'Someone requested a password reset for your SalesBrain account.',
      'If that was you, follow this link to set a new password:',
      '',
      resetLink,
      '',
      `This link expires in ${TOKEN_TTL_HOURS} hour and can only be used once.`,
      '',
      "If you didn't request this, you can safely ignore this email — your password won't change.",
      '',
      '— SalesBrain',
    ].join('\n');

    try {
      await sendEmail({ to: user.email, subject, body: bodyText });
    } catch (err) {
      // Fall back to console log for dev when RESEND_API_KEY is not configured
      console.warn('[forgot-password] Email send failed, logging link for manual delivery:', err);
      console.log(`[forgot-password] Reset link for ${user.email}: ${resetLink}`);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[forgot-password] Unexpected error:', err);
    // Still respond success to avoid leaking system state
    return NextResponse.json({ ok: true });
  }
}
