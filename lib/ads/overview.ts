import type { AdsOverview, ProviderReport } from '@/lib/marketing';
import { googleAdsEnvMissing, googleCampaignMetrics } from '@/lib/ads/google';
import { linkedInAccessToken, linkedInAdsEnvMissing, linkedInCampaignMetrics } from '@/lib/ads/linkedin';

/**
 * Live campaign performance for the last N days, read straight from the ad
 * platforms (10-minute cache per process inside each reader). Org-wide, like
 * /pipeline. One provider failing never hides the other: each carries its own
 * `ok`/`error`. Shared by GET /api/marketing/overview and the service MCP's
 * `marketing_overview`. Round 2's daily sync will serve the same shape from
 * ad_metrics_daily.
 */
export async function adsOverview(daysWanted: number): Promise<AdsOverview> {
  const days = Math.min(365, Math.max(1, Number(daysWanted) || 30));
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

  return { days, ...range, providers };
}

export interface ProviderTotals {
  provider: ProviderReport['provider'];
  ok: boolean;
  error: string | null;
  currency: string | null;
  campaigns: number;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  platform_conversions: number;
  platform_leads: number;
  /** Spend on the most recent closed day and the day before it — "yesterday / today" for a stand-up. */
  spend_last_day: number;
  spend_day_before: number;
}

/** Per-provider sums an assistant can quote without adding up campaign rows. */
export function providerTotals(o: AdsOverview): ProviderTotals[] {
  return o.providers.map((p) => {
    const sum = (k: 'spend' | 'impressions' | 'clicks' | 'platform_conversions' | 'platform_leads') =>
      p.campaigns.reduce((a, c) => a + (Number(c[k]) || 0), 0);
    const spend = sum('spend'), impressions = sum('impressions'), clicks = sum('clicks');
    const byDay = [...p.days].sort((a, b) => (a.day < b.day ? 1 : -1));
    const dayTotal = (d: string | undefined) => (d ? p.days.filter((x) => x.day === d).reduce((a, x) => a + (Number(x.spend) || 0), 0) : 0);
    const distinctDays = Array.from(new Set(byDay.map((x) => x.day)));
    return {
      provider: p.provider, ok: p.ok, error: p.error, currency: p.currency, campaigns: p.campaigns.length,
      spend: round(spend), impressions, clicks,
      ctr: impressions ? round(clicks / impressions, 4) : null,
      cpc: clicks ? round(spend / clicks) : null,
      platform_conversions: sum('platform_conversions'), platform_leads: sum('platform_leads'),
      spend_last_day: round(dayTotal(distinctDays[0])), spend_day_before: round(dayTotal(distinctDays[1])),
    };
  });
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
