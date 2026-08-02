import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { exchangeCodeForToken, getGoogleUserEmail } from '@/lib/google-oauth';

/**
 * Build an absolute URL anchored at the PUBLIC origin, not the internal Node
 * bind (localhost:3002). Caddy forwards X-Forwarded-Host/Proto — use them,
 * otherwise req.url would route redirects back to the internal port.
 */
function publicUrl(req: NextRequest, path: string): URL {
  // NEXT_PUBLIC_APP_URL is the most reliable source when configured.
  const envBase = process.env.NEXT_PUBLIC_APP_URL;
  if (envBase) {
    return new URL(path, envBase);
  }
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.headers.get('host') || req.nextUrl.host;
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto = forwardedProto || req.nextUrl.protocol.replace(':', '') || 'https';
  return new URL(path, `${proto}://${host}`);
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(publicUrl(req, '/login'));

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');

  if (error) {
    return NextResponse.redirect(publicUrl(req, `/profile?tab=imports&error=${encodeURIComponent(error)}`));
  }
  if (!code) {
    return NextResponse.redirect(publicUrl(req, '/profile?tab=imports&error=missing_code'));
  }
  if (state !== session.userId) {
    return NextResponse.redirect(publicUrl(req, '/profile?tab=imports&error=invalid_state'));
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

    return NextResponse.redirect(publicUrl(req, '/profile?tab=imports&connected=google'));
  } catch (err) {
    console.error('[Google OAuth callback]', err);
    return NextResponse.redirect(
      publicUrl(req, `/profile?tab=imports&error=${encodeURIComponent(err instanceof Error ? err.message : 'exchange_failed')}`)
    );
  }
}
