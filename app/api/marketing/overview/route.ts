import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import type { AdsOverview, ProviderReport } from '@/lib/marketing';
import { googleAdsEnvMissing, googleCampaignMetrics } from '@/lib/ads/google';
import { linkedInAccessToken, linkedInAdsEnvMissing, linkedInCampaignMetrics } from '@/lib/ads/linkedin';

/**
 * Live campaign performance for the last N days, read straight from the ad
 * platforms (10-minute cache per process). Org-wide, like /pipeline. One
 * provider failing never hides the other: each carries its own `ok`/`error`.
 * Round 2's daily sync will serve the same shape from ad_metrics_daily.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get('days') || 30)));
  const until = new Date(); until.setUTCDate(until.getUTCDate() - 1);          // platforms close a day late
  const since = new Date(until); since.setUTCDate(since.getUTCDate() - (days - 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const range = { since: iso(since), until: iso(until) };

  const providers: ProviderReport[] = [];
  const now = new Date().toISOString();
  const empty = (provider: ProviderReport['provider'], error: string | null): ProviderReport =>
    ({ provider, ok: false, error, currency: null, campaigns: [], days: [], fetched_at: now });

  if (googleAdsEnvMissing().length) providers.push(empty('google_ads', 'not configured'));
  else {
    try {
      const r = await googleCampaignMetrics(range.since, range.until);
      providers.push({ provider: 'google_ads', ok: true, error: null, currency: r.currency, campaigns: r.campaigns, days: r.days, fetched_at: now });
    } catch (err) { providers.push(empty('google_ads', err instanceof Error ? err.message : 'failed')); }
  }

  if (linkedInAdsEnvMissing().length) providers.push(empty('linkedin_ads', 'not configured'));
  else {
    try {
      const tok = await linkedInAccessToken();
      if (!tok) providers.push(empty('linkedin_ads', 'not connected'));
      else {
        const r = await linkedInCampaignMetrics(tok.token, range.since, range.until);
        providers.push({ provider: 'linkedin_ads', ok: true, error: null, currency: r.currency, campaigns: r.campaigns, days: r.days, fetched_at: now });
      }
    } catch (err) { providers.push(empty('linkedin_ads', err instanceof Error ? err.message : 'failed')); }
  }

  const body: AdsOverview = { days, ...range, providers };
  return NextResponse.json(body);
}
