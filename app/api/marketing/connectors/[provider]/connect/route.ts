import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isAdProvider, PROVIDER_META } from '@/lib/marketing';
import { publicUrl } from '@/lib/public-url';
import { googleAdsEnvMissing, probeGoogleAds } from '@/lib/ads/google';
import { linkedInAdsEnvMissing, linkedInAuthUrl } from '@/lib/ads/linkedin';
import { invalidate } from '@/lib/ads/cache';

/**
 * Google Ads: there is nothing to connect per person — this VERIFIES the
 * service-account setup with one API call and reports the account it sees.
 * LinkedIn Ads: redirects to the consent screen; the callback stores the token.
 * Both answer 501 + `missing_env[]` while the server lacks configuration.
 */
export async function GET(req: NextRequest, { params }: { params: { provider: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdProvider(params.provider)) return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
  const meta = PROVIDER_META[params.provider];

  if (params.provider === 'google_ads') {
    const missing = googleAdsEnvMissing();
    if (missing.length) return NextResponse.json({ error: `${meta.label} is not configured on this server`, missing_env: missing }, { status: 501 });
    try {
      invalidate('google_ads:');
      const probe = await probeGoogleAds();
      return NextResponse.json({ ok: true, verified: probe });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'probe failed', missing_env: [] }, { status: 502 });
    }
  }

  const missing = linkedInAdsEnvMissing();
  if (missing.length) return NextResponse.json({ error: `${meta.label} is not configured on this server`, missing_env: missing }, { status: 501 });
  const redirect = publicUrl(req, '/api/marketing/connectors/linkedin_ads/callback').toString();
  // state = userId, checked in the callback (same pattern as the Google OAuth flow).
  return NextResponse.redirect(linkedInAuthUrl(redirect, session.userId));
}
