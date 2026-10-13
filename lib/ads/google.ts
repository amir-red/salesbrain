/**
 * Google Ads — service-account access + campaign metrics (server only).
 *
 * Auth: the JSON key in GOOGLE_ADS_SERVICE_ACCOUNT_JSON (raw JSON or base64)
 * signs an RS256 JWT for the `adwords` scope → short-lived access token. The
 * service account email must be a user on the ad account (Admin → Access).
 * API: REST `googleAds:searchStream` with a GAQL query. Version pinned in
 * GOOGLE_ADS_API_VERSION (default v21 — Google retires each version ~12 months
 * after release; bump when the API answers 404 for the version).
 */
import { createSign } from 'crypto';
import type { CampaignRow, DayRow } from '@/lib/marketing';
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

async function searchStream<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const version = process.env.GOOGLE_ADS_API_VERSION || 'v21';
  const customer = digits(process.env.GOOGLE_ADS_CUSTOMER_ID || '');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    'Content-Type': 'application/json',
  };
  const login = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if (login) headers['login-customer-id'] = digits(login);
  const res = await fetch(`https://googleads.googleapis.com/${version}/customers/${customer}/googleAds:searchStream`, {
    method: 'POST', headers, body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text.slice(0, 400);
    try {
      const j = JSON.parse(text);
      const e = Array.isArray(j) ? j[0]?.error : j.error;
      msg = e?.details?.[0]?.errors?.[0]?.message || e?.message || msg;
    } catch { /* keep raw */ }
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
