import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import pool from '@/lib/db';
import { hashPassword, setSession } from '@/lib/auth';

const Schema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * POST /api/auth/reset-password
 * Verifies a reset token (unexpired + unused), updates the user's password,
 * marks the token used, and auto-logs the user in.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message || 'Invalid input';
    return NextResponse.json({ error: firstError }, { status: 400 });
  }

  const { token, password } = parsed.data;
  const tokenHash = hashToken(token);

  // Look up token
  const { rows } = await pool.query(
    `SELECT pr.id, pr.user_id, pr.expires_at, pr.used_at, u.email, u.name, u.role
     FROM password_resets pr
     JOIN users u ON u.id = pr.user_id
     WHERE pr.token_hash = $1 LIMIT 1`,
    [tokenHash]
  );
  const reset = rows[0];

  if (!reset) {
    return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });
  }
  if (reset.used_at) {
    return NextResponse.json({ error: 'This reset link has already been used' }, { status: 400 });
  }
  if (new Date(reset.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This reset link has expired. Please request a new one.' }, { status: 400 });
  }

  const newHash = await hashPassword(password);

  // Atomically mark the token used and update the password.
  // WHERE used_at IS NULL prevents a race where the token is used twice.
  await pool.query(`BEGIN`);
  try {
    const { rowCount: usedCount } = await pool.query(
      `UPDATE password_resets SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
      [reset.id]
    );
    if (!usedCount) {
      await pool.query(`ROLLBACK`);
      return NextResponse.json({ error: 'This reset link has already been used' }, { status: 400 });
    }

    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, reset.user_id]);

    // Invalidate any other pending reset tokens for this user
    await pool.query(
      `UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL AND id <> $2`,
      [reset.user_id, reset.id]
    );

    await pool.query(`COMMIT`);
  } catch (err) {
    await pool.query(`ROLLBACK`);
    console.error('[reset-password] Transaction failed:', err);
    return NextResponse.json({ error: 'Could not reset password. Try again.' }, { status: 500 });
  }

  // Auto-login the user with a fresh session
  await setSession({
    userId: reset.user_id,
    email: reset.email,
    name: reset.name,
    role: reset.role || 'user',
  });

  return NextResponse.json({ ok: true });
}
