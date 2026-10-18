import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isAdProvider, isYmd } from '@/lib/marketing';
import { googleAdsEnvMissing, googleCampaignDetail } from '@/lib/ads/google';
import { linkedInAccessToken, linkedInAdsEnvMissing, linkedInCampaignDetail } from '@/lib/ads/linkedin';

/**
 * One campaign in depth, read live (10-min cache): setup, budget, daily series,
 * ad groups (Google) and ads with metrics over [since, until] — the campaign popup on /marketing.
 *   GET ?provider=google_ads|linkedin_ads&id=<campaign id>&since=YYYY-MM-DD&until=YYYY-MM-DD
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const provider = q.get('provider') ?? '', id = q.get('id') ?? '', since = q.get('since'), until = q.get('until');
  if (!isAdProvider(provider)) return NextResponse.json({ error: 'unknown provider' }, { status: 400 });
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'id must be a numeric campaign id' }, { status: 400 });
  if (!isYmd(since) || !isYmd(until) || since > until) return NextResponse.json({ error: 'since and until must be YYYY-MM-DD, since ≤ until' }, { status: 400 });
  try {
    if (provider === 'google_ads') {
      if (googleAdsEnvMissing().length) return NextResponse.json({ error: 'Google Ads is not configured' }, { status: 501 });
      return NextResponse.json(await googleCampaignDetail(id, since, until));
    }
    if (linkedInAdsEnvMissing().length) return NextResponse.json({ error: 'LinkedIn Ads is not configured' }, { status: 501 });
    const tok = await linkedInAccessToken();
    if (!tok) return NextResponse.json({ error: 'LinkedIn Ads is not connected' }, { status: 501 });
    return NextResponse.json(await linkedInCampaignDetail(tok.token, id, since, until));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 502 });
  }
}
