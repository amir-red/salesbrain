import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

/**
 * Returns which OAuth providers the current user is connected to.
 * Used by /integrations to show the correct connect/connected state
 * on page load (not just when arriving from the OAuth callback with ?connected=...).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows } = await pool.query(
    `SELECT provider, account_email, expires_at, refresh_token IS NOT NULL AS has_refresh
     FROM oauth_tokens WHERE user_id = $1`,
    [session.userId]
  );

  const providers: Record<string, { account_email: string | null; expires_at: string | null; has_refresh: boolean }> = {};
  for (const r of rows) {
    providers[r.provider] = {
      account_email: r.account_email,
      expires_at: r.expires_at,
      has_refresh: r.has_refresh,
    };
  }

  return NextResponse.json({ providers });
}
