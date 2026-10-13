/**
 * LinkedIn Ads — 3-legged OAuth + adAnalytics (server only).
 *
 * One teammate with access to the ad account connects; the token row lives in
 * `oauth_tokens` (provider 'linkedin_ads') and reporting uses the newest one,
 * because the ad account (LINKEDIN_ADS_ACCOUNT_ID) is the company's, not the
 * person's. Access tokens last 60 days; refresh tokens exist only when the app
 * has programmatic refresh enabled — otherwise the card asks to reconnect.
 * API: versioned REST (`LinkedIn-Version`, default 202509; LinkedIn drops a
 * version ~12 months after release — bump when it answers 426).
 */
import pool from '@/lib/db';
import type { CampaignRow, DayRow } from '@/lib/marketing';
import { cached } from './cache';

const SCOPES = ['r_ads', 'r_ads_reporting'];
const API = 'https://api.linkedin.com/rest';

export function linkedInAdsEnvMissing(): string[] {
  return ['LINKEDIN_ADS_CLIENT_ID', 'LINKEDIN_ADS_CLIENT_SECRET', 'LINKEDIN_ADS_ACCOUNT_ID'].filter((k) => !process.env[k]);
}

export function linkedInAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code', client_id: process.env.LINKEDIN_ADS_CLIENT_ID || '', redirect_uri: redirectUri, state, scope: SCOPES.join(' '),
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
}

interface TokenResponse { access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number; scope?: string }

async function tokenCall(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...body, client_id: process.env.LINKEDIN_ADS_CLIENT_ID || '', client_secret: process.env.LINKEDIN_ADS_CLIENT_SECRET || '' }),
  });
  if (!res.ok) throw new Error(`LinkedIn token call failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as TokenResponse;
}

export function exchangeLinkedInCode(code: string, redirectUri: string) {
  return tokenCall({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

export async function linkedInMemberLabel(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const d = (await res.json()) as { name?: string; email?: string };
    return d.email ?? d.name ?? null;
  } catch { return null; }
}

/** Newest stored LinkedIn Ads token for the org, refreshed when possible. */
export async function linkedInAccessToken(): Promise<{ token: string; row_id: string } | null> {
  const { rows } = await pool.query(
    `SELECT id, access_token, refresh_token, expires_at FROM oauth_tokens WHERE provider = 'linkedin_ads' ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return null;
  const expires = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expires > Date.now() + 5 * 60 * 1000) return { token: row.access_token, row_id: row.id };
  if (!row.refresh_token) throw new Error('LinkedIn Ads token expired and the app has no refresh token — reconnect on /marketing/connectors');
  const t = await tokenCall({ grant_type: 'refresh_token', refresh_token: row.refresh_token });
  await pool.query(
    `UPDATE oauth_tokens SET access_token = $1, refresh_token = COALESCE($2, refresh_token), expires_at = $3, updated_at = now() WHERE id = $4`,
    [t.access_token, t.refresh_token ?? null, new Date(Date.now() + t.expires_in * 1000).toISOString(), row.id],
  );
  return { token: t.access_token, row_id: row.id };
}

async function li<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'LinkedIn-Version': process.env.LINKEDIN_API_VERSION || '202509',
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text.slice(0, 400);
    try { msg = (JSON.parse(text) as { message?: string }).message || msg; } catch { /* raw */ }
    throw new Error(`LinkedIn API ${res.status}: ${msg}`);
  }
  return (await res.json()) as T;
}

const accountId = () => (process.env.LINKEDIN_ADS_ACCOUNT_ID || '').replace(/\D/g, '');

export async function probeLinkedInAds(token: string): Promise<{ account_id: string; name: string | null; currency: string | null }> {
  const a = await li<{ name?: string; currency?: string }>(`/adAccounts/${accountId()}`, token);
  return { account_id: accountId(), name: a.name ?? null, currency: a.currency ?? null };
}

const dr = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `(year:${y},month:${m},day:${d})`; };

interface AnalyticsElement {
  pivotValues?: string[];
  dateRange?: { start: { year: number; month: number; day: number } };
  impressions?: number; clicks?: number; costInLocalCurrency?: string; externalWebsiteConversions?: number; oneClickLeads?: number;
}

export async function linkedInCampaignMetrics(token: string, since: string, until: string): Promise<{ currency: string; campaigns: CampaignRow[]; days: DayRow[] }> {
  return cached(`linkedin_ads:metrics:${since}:${until}`, 10 * 60 * 1000, async () => {
    const acct = accountId();
    const [account, analytics] = await Promise.all([
      li<{ currency?: string }>(`/adAccounts/${acct}`, token),
      li<{ elements?: AnalyticsElement[] }>(
        `/adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY` +
        `&dateRange=(start:${dr(since)},end:${dr(until)})` +
        `&accounts=List(urn%3Ali%3AsponsoredAccount%3A${acct})` +
        `&fields=impressions,clicks,costInLocalCurrency,externalWebsiteConversions,oneClickLeads,pivotValues,dateRange`,
        token,
      ),
    ]);
    const currency = account.currency ?? 'EUR';
    const byCampaign = new Map<string, CampaignRow>();
    const byDay = new Map<string, DayRow>();
    for (const e of analytics.elements ?? []) {
      const id = (e.pivotValues?.[0] ?? '').split(':').pop() || 'unknown';
      const spend = Number(e.costInLocalCurrency ?? 0);
      const imp = e.impressions ?? 0, clk = e.clicks ?? 0;
      const c = byCampaign.get(id) ?? {
        provider: 'linkedin_ads', campaign_id: id, campaign_name: `Campaign ${id}`, status: null, channel: null, currency,
        impressions: 0, clicks: 0, spend: 0, platform_conversions: 0, platform_leads: 0,
      };
      c.impressions += imp; c.clicks += clk; c.spend += spend;
      c.platform_conversions += e.externalWebsiteConversions ?? 0; c.platform_leads += e.oneClickLeads ?? 0;
      byCampaign.set(id, c);
      const s = e.dateRange?.start;
      const day = s ? `${s.year}-${String(s.month).padStart(2, '0')}-${String(s.day).padStart(2, '0')}` : since;
      const d = byDay.get(day) ?? { day, provider: 'linkedin_ads', impressions: 0, clicks: 0, spend: 0, currency };
      d.impressions += imp; d.clicks += clk; d.spend += spend;
      byDay.set(day, d);
    }
    // Names, status and type: one batch get for every campaign that had a row.
    const ids = [...byCampaign.keys()].filter((k) => /^\d+$/.test(k));
    if (ids.length) {
      try {
        const got = await li<{ results?: Record<string, { name?: string; status?: string; type?: string; format?: string }> }>(
          `/adAccounts/${acct}/adCampaigns?ids=List(${ids.join(',')})`, token,
        );
        for (const [id, c] of Object.entries(got.results ?? {})) {
          const row = byCampaign.get(id);
          if (!row) continue;
          row.campaign_name = c.name ?? row.campaign_name; row.status = c.status ?? null; row.channel = c.format ?? c.type ?? null;
        }
      } catch (err) {
        console.warn('[linkedin_ads] campaign names unavailable:', err instanceof Error ? err.message : err);
      }
    }
    return { currency, campaigns: [...byCampaign.values()], days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)) };
  });
}
