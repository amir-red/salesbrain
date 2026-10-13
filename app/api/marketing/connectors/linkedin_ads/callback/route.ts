import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { publicUrl } from '@/lib/public-url';
import { exchangeLinkedInCode, linkedInMemberLabel } from '@/lib/ads/linkedin';
import { invalidate } from '@/lib/ads/cache';

const back = (req: NextRequest, qs: string) => NextResponse.redirect(publicUrl(req, `/marketing/connectors?${qs}`));

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(publicUrl(req, '/login'));
  const q = req.nextUrl.searchParams;
  if (q.get('error')) return back(req, `error=${encodeURIComponent(q.get('error_description') || q.get('error') || 'denied')}`);
  const code = q.get('code');
  if (!code) return back(req, 'error=missing_code');
  if (q.get('state') !== session.userId) return back(req, 'error=invalid_state');

  try {
    const redirect = publicUrl(req, '/api/marketing/connectors/linkedin_ads/callback').toString();
    const t = await exchangeLinkedInCode(code, redirect);
    const label = await linkedInMemberLabel(t.access_token);
    await pool.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, scopes, account_email)
       VALUES ($1, 'linkedin_ads', $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
         expires_at = EXCLUDED.expires_at, scopes = EXCLUDED.scopes, account_email = EXCLUDED.account_email, updated_at = now()`,
      [session.userId, t.access_token, t.refresh_token ?? null, new Date(Date.now() + t.expires_in * 1000).toISOString(), (t.scope || 'r_ads r_ads_reporting').split(/[ ,]+/), label],
    );
    invalidate('linkedin_ads:');
    return back(req, 'connected=linkedin_ads');
  } catch (err) {
    console.error('[linkedin_ads callback]', err);
    return back(req, `error=${encodeURIComponent(err instanceof Error ? err.message : 'exchange_failed')}`);
  }
}
