/**
 * Google Ads — service-account access + campaign metrics (server only).
 *
 * Auth: the JSON key in GOOGLE_ADS_SERVICE_ACCOUNT_JSON (raw JSON or base64)
 * signs an RS256 JWT for the `adwords` scope → short-lived access token. The
 * service account email must be a user on the ad account (Admin → Access).
 * API: REST `googleAds:searchStream` with a GAQL query. Version pinned in
 * GOOGLE_ADS_API_VERSION (default v23 — Google retires each version ~12 months
 * after release; bump when the API answers 404 for the version).
 */
import { createSign } from 'crypto';
import type { AdGroupRow, AdRow, CampaignDetail, CampaignRow, DayRow } from '@/lib/marketing';
import { cached } from './cache';

const SCOPE = 'https://www.googleapis.com/auth/adwords';

interface ServiceAccountKey { client_email: string; private_key: string; token_uri?: string }

export function serviceAccount(): ServiceAccountKey | null {
  const raw = process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const key = JSON.parse(text) as ServiceAccountKey;
    if (!key.client_email || !key.private_key) return null;
    return key;
  } catch {
    return null;
  }
}

export function googleAdsEnvMissing(): string[] {
  const missing: string[] = [];
  if (!serviceAccount()) missing.push('GOOGLE_ADS_SERVICE_ACCOUNT_JSON');
  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) missing.push('GOOGLE_ADS_DEVELOPER_TOKEN');
  if (!process.env.GOOGLE_ADS_CUSTOMER_ID) missing.push('GOOGLE_ADS_CUSTOMER_ID');
  return missing;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function accessToken(): Promise<string> {
  return cached('google_ads:token', 50 * 60 * 1000, async () => {
    const key = serviceAccount();
    if (!key) throw new Error('GOOGLE_ADS_SERVICE_ACCOUNT_JSON is missing or not a valid service-account key');
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({
      iss: key.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const sig = b64url(signer.sign(key.private_key));
    const res = await fetch(key.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${sig}` }),
    });
    if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { access_token: string };
    return data.access_token;
  });
}

const digits = (s: string) => s.replace(/\D/g, '');

// Whether the manager id in GOOGLE_ADS_LOGIN_CUSTOMER_ID is the right door. When the
// service account was invited on the AD ACCOUNT itself (not on the manager), Google
// answers 403 with the header set and 200 without it — so a 403 with the header
// triggers one retry without it, and the answer is remembered for the process.
let loginHeaderWorks: boolean | null = null;

async function searchStream<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const version = process.env.GOOGLE_ADS_API_VERSION || 'v23';
  const customer = digits(process.env.GOOGLE_ADS_CUSTOMER_ID || '');
  const login = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ? digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) : '';
  const token = await accessToken();

  const call = async (withLogin: boolean) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
      'Content-Type': 'application/json',
    };
    if (withLogin && login) headers['login-customer-id'] = login;
    return fetch(`https://googleads.googleapis.com/${version}/customers/${customer}/googleAds:searchStream`, {
      method: 'POST', headers, body: JSON.stringify({ query }),
    });
  };

  let useLogin = !!login && loginHeaderWorks !== false;
  let res = await call(useLogin);
  if (res.status === 403 && useLogin) {
    const retry = await call(false);
    if (retry.ok) { loginHeaderWorks = false; res = retry; useLogin = false; }
  } else if (res.ok && useLogin) {
    loginHeaderWorks = true;
  }

  if (!res.ok) {
    const text = await res.text();
    let msg = text.slice(0, 400);
    if (res.status === 404 && text.startsWith('<')) {
      msg = `API version ${version} is not served — set GOOGLE_ADS_API_VERSION to a current one`;
    } else {
      try {
        const j = JSON.parse(text);
        const e = Array.isArray(j) ? j[0]?.error : j.error;
        msg = e?.details?.[0]?.errors?.[0]?.message || e?.message || msg;
      } catch { /* keep raw */ }
    }
    throw new Error(`Google Ads API ${res.status}: ${msg}`);
  }
  const batches = (await res.json()) as Array<{ results?: T[] }>;
  return batches.flatMap((b) => b.results ?? []);
}

/** One cheap call that proves token + developer token + account access all work. */
export async function probeGoogleAds(): Promise<{ customer_id: string; name: string | null; currency: string | null }> {
  const rows = await searchStream<{ customer: { id: string; descriptiveName?: string; currencyCode?: string } }>(
    'SELECT customer.id, customer.descriptive_name, customer.currency_code FROM customer',
  );
  const c = rows[0]?.customer;
  return { customer_id: c?.id ?? digits(process.env.GOOGLE_ADS_CUSTOMER_ID || ''), name: c?.descriptiveName ?? null, currency: c?.currencyCode ?? null };
}

interface GaqlRow {
  campaign: { id: string; name: string; status?: string; advertisingChannelType?: string };
  customer?: { currencyCode?: string };
  segments: { date: string };
  metrics: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number };
}

export async function googleCampaignMetrics(since: string, until: string): Promise<{ currency: string; campaigns: CampaignRow[]; days: DayRow[] }> {
  return cached(`google_ads:metrics:${since}:${until}`, 10 * 60 * 1000, async () => {
    const rows = await searchStream<GaqlRow>(
      `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, customer.currency_code,
              segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
         FROM campaign
        WHERE segments.date BETWEEN '${since}' AND '${until}' AND campaign.status != 'REMOVED'`,
    );
    const currency = rows[0]?.customer?.currencyCode ?? 'EUR';
    const byCampaign = new Map<string, CampaignRow>();
    const byDay = new Map<string, DayRow>();
    for (const r of rows) {
      const spend = Number(r.metrics.costMicros ?? 0) / 1e6;
      const imp = Number(r.metrics.impressions ?? 0);
      const clk = Number(r.metrics.clicks ?? 0);
      const conv = Number(r.metrics.conversions ?? 0);
      const c = byCampaign.get(r.campaign.id) ?? {
        provider: 'google_ads', campaign_id: r.campaign.id, campaign_name: r.campaign.name, status: r.campaign.status ?? null,
        channel: r.campaign.advertisingChannelType ?? null, currency, impressions: 0, clicks: 0, spend: 0, platform_conversions: 0, platform_leads: 0,
      };
      c.impressions += imp; c.clicks += clk; c.spend += spend; c.platform_conversions += conv;
      byCampaign.set(r.campaign.id, c);
      const d = byDay.get(r.segments.date) ?? { day: r.segments.date, provider: 'google_ads', impressions: 0, clicks: 0, spend: 0, currency };
      d.impressions += imp; d.clicks += clk; d.spend += spend;
      byDay.set(r.segments.date, d);
    }
    return { currency, campaigns: [...byCampaign.values()], days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)) };
  });
}

// ─── Campaign drill-down ────────────────────────────────────────────────────

const label = (s: string | null | undefined) =>
  s ? s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : null;
const num = (x: unknown) => Number(x ?? 0) || 0;

interface GMetrics { impressions?: string; clicks?: string; costMicros?: string; conversions?: number }
const metricsOf = (m: GMetrics | undefined) => ({
  spend: num(m?.costMicros) / 1e6, impressions: num(m?.impressions), clicks: num(m?.clicks), results: num(m?.conversions),
});

/** One campaign: setup, budget, daily series, every ad group and ad (incl. paused ones), metrics over the range. */
export async function googleCampaignDetail(campaignId: string, since: string, until: string): Promise<CampaignDetail> {
  if (!/^\d+$/.test(campaignId)) throw new Error('invalid Google Ads campaign id');
  return cached(`google_ads:campaign:${campaignId}:${since}:${until}`, 10 * 60 * 1000, async () => {
    const range = `segments.date BETWEEN '${since}' AND '${until}'`;
    const [meta, daily, groupsAll, groupsM, adsAll, adsM] = await Promise.all([
      searchStream<{ campaign: { name: string; status?: string; advertisingChannelType?: string; biddingStrategyType?: string };
                     campaignBudget?: { amountMicros?: string }; customer?: { currencyCode?: string } }>(
        `SELECT campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type,
                campaign_budget.amount_micros, customer.currency_code FROM campaign WHERE campaign.id = ${campaignId}`),
      searchStream<{ segments: { date: string }; metrics: GMetrics }>(
        `SELECT segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
           FROM campaign WHERE campaign.id = ${campaignId} AND ${range}`),
      searchStream<{ adGroup: { id: string; name: string; status: string; type?: string } }>(
        `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type FROM ad_group
          WHERE campaign.id = ${campaignId} AND ad_group.status != 'REMOVED'`),
      searchStream<{ adGroup: { id: string }; metrics: GMetrics }>(
        `SELECT ad_group.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM ad_group
          WHERE campaign.id = ${campaignId} AND ${range}`),
      searchStream<{ adGroup: { id: string; name?: string }; adGroupAd: { status: string; ad: {
          id: string; name?: string; type?: string; finalUrls?: string[];
          responsiveSearchAd?: { headlines?: { text?: string }[]; descriptions?: { text?: string }[] } };
          policySummary?: { approvalStatus?: string } } }>(
        `SELECT ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.status,
                ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines,
                ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.policy_summary.approval_status
           FROM ad_group_ad WHERE campaign.id = ${campaignId} AND ad_group_ad.status != 'REMOVED'`),
      searchStream<{ adGroupAd: { ad: { id: string } }; metrics: GMetrics }>(
        `SELECT ad_group_ad.ad.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
           FROM ad_group_ad WHERE campaign.id = ${campaignId} AND ${range}`),
    ]);
    const c = meta[0];
    if (!c) throw new Error('campaign not found in this Google Ads account');
    const currency = c.customer?.currencyCode ?? 'EUR';
    const campaignOn = c.campaign.status === 'ENABLED';

    const gm = new Map(groupsM.map((r) => [r.adGroup.id, metricsOf(r.metrics)]));
    const groups: AdGroupRow[] = groupsAll.map((r) => ({
      id: r.adGroup.id, name: r.adGroup.name, status: label(r.adGroup.status) ?? r.adGroup.status,
      active: campaignOn && r.adGroup.status === 'ENABLED', type: label(r.adGroup.type),
      ...(gm.get(r.adGroup.id) ?? { spend: 0, impressions: 0, clicks: 0, results: 0 }),
    }));
    const groupById = new Map(groupsAll.map((r) => [r.adGroup.id, r.adGroup]));

    const am = new Map<string, ReturnType<typeof metricsOf>>();
    for (const r of adsM) {
      const prev = am.get(r.adGroupAd.ad.id), m = metricsOf(r.metrics);
      am.set(r.adGroupAd.ad.id, prev ? { spend: prev.spend + m.spend, impressions: prev.impressions + m.impressions,
        clicks: prev.clicks + m.clicks, results: prev.results + m.results } : m);
    }
    const ads: AdRow[] = adsAll.map((r) => {
      const ad = r.adGroupAd.ad, g = groupById.get(r.adGroup.id);
      const heads = (ad.responsiveSearchAd?.headlines ?? []).map((h) => h.text).filter(Boolean) as string[];
      const descs = (ad.responsiveSearchAd?.descriptions ?? []).map((h) => h.text).filter(Boolean) as string[];
      const adOn = r.adGroupAd.status === 'ENABLED', groupOn = g?.status === 'ENABLED';
      const status = !adOn ? label(r.adGroupAd.status) ?? r.adGroupAd.status
        : !groupOn ? 'Enabled (ad group paused)' : !campaignOn ? 'Enabled (campaign paused)' : 'Enabled';
      return {
        id: ad.id, name: ad.name || heads.slice(0, 3).join(' | ') || label(ad.type) || `Ad ${ad.id}`,
        detail: descs[0] ?? null, type: label(ad.type), status, active: adOn && groupOn && campaignOn,
        approval: label(r.adGroupAd.policySummary?.approvalStatus), url: ad.finalUrls?.[0] ?? null,
        group_id: r.adGroup.id, group_name: g?.name ?? r.adGroup.name ?? null,
        ...(am.get(ad.id) ?? { spend: 0, impressions: 0, clicks: 0, results: 0 }),
      };
    });

    const days = daily.map((r) => ({ day: r.segments.date, ...metricsOf(r.metrics) }))
      .sort((a, b) => a.day.localeCompare(b.day))
      .map(({ day, spend, impressions, clicks }) => ({ day, spend, impressions, clicks }));
    const totals = daily.reduce((t, r) => { const m = metricsOf(r.metrics);
      return { spend: t.spend + m.spend, impressions: t.impressions + m.impressions, clicks: t.clicks + m.clicks, results: t.results + m.results }; },
      { spend: 0, impressions: 0, clicks: 0, results: 0 });

    return {
      provider: 'google_ads', campaign_id: campaignId, name: c.campaign.name,
      status: label(c.campaign.status) ?? '', active: campaignOn, currency, since, until,
      setup: [label(c.campaign.advertisingChannelType), label(c.campaign.biddingStrategyType)].filter(Boolean) as string[],
      budget: c.campaignBudget?.amountMicros ? { amount: num(c.campaignBudget.amountMicros) / 1e6, currency, period: 'daily' } : null,
      parent: null, totals, days, groups, ads,
      notes: ['Results = conversions as Google reports them (not CRM leads).'],
    };
  });
}
