import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { exchangeCodeForToken, getGoogleUserEmail } from '@/lib/google-oauth';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL('/login', req.url));

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL(`/integrations?error=${encodeURIComponent(error)}`, req.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL('/integrations?error=missing_code', req.url));
  }
  if (state !== session.userId) {
    return NextResponse.redirect(new URL('/integrations?error=invalid_state', req.url));
  }

  try {
    const tokens = await exchangeCodeForToken(code);
    const email = await getGoogleUserEmail(tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await pool.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, scopes, account_email)
       VALUES ($1, 'google', $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
         expires_at = EXCLUDED.expires_at,
         scopes = EXCLUDED.scopes,
         account_email = EXCLUDED.account_email,
         updated_at = now()`,
      [
        session.userId,
        tokens.access_token,
        tokens.refresh_token || null,
        expiresAt,
        ['email', 'contacts.readonly', 'gmail.readonly'],
        email,
      ]
    );

    return NextResponse.redirect(new URL('/integrations?connected=google', req.url));
  } catch (err) {
    console.error('[Google OAuth callback]', err);
    return NextResponse.redirect(
      new URL(`/integrations?error=${encodeURIComponent(err instanceof Error ? err.message : 'exchange_failed')}`, req.url)
    );
  }
}
