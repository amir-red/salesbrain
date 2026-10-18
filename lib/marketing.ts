/**
 * Marketing (paid ads) — client-safe vocabulary shared by /marketing pages and
 * /api/marketing routes. No DB or IO imports here (server code is in lib/ads/*).
 *
 * Two connector shapes, chosen by what each platform supports for a shared
 * company ad account:
 *  - Google Ads: a SERVICE ACCOUNT the operator adds as a (read-only) user on
 *    the ad account. Configured once in env; nothing per person to connect.
 *  - LinkedIn Ads: 3-legged OAuth. One teammate with access to the ad account
 *    connects; the token is stored in `oauth_tokens` (provider 'linkedin_ads')
 *    and used for the whole org's reporting.
 */

export type AdProvider = 'google_ads' | 'linkedin_ads';

export const AD_PROVIDERS: AdProvider[] = ['google_ads', 'linkedin_ads'];

export interface ProviderMeta {
  id: AdProvider;
  label: string;
  blurb: string;
  auth: 'service_account' | 'oauth';
  /** OAuth scopes (oauth) or API scope the service account token asks for. */
  scopes: string[];
  /** Server env vars the provider needs before it can be used. */
  env: string[];
  /** Operator prerequisites outside this codebase. */
  prerequisites: string[];
  docs: string;
}

export const PROVIDER_META: Record<AdProvider, ProviderMeta> = {
  google_ads: {
    id: 'google_ads',
    label: 'Google Ads',
    blurb: 'Search, Performance Max and Display campaigns. Read via the Google Ads API (GAQL) as a service account.',
    auth: 'service_account',
    scopes: ['https://www.googleapis.com/auth/adwords'],
    env: ['GOOGLE_ADS_SERVICE_ACCOUNT_JSON', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'],
    prerequisites: [
      'In the Google Cloud project: enable the Google Ads API and create a JSON key for the service account.',
      'In Google Ads: Admin → Access and security → invite the service account email as a user (Read only is enough).',
      'Developer token from a Google Ads MANAGER account (Tools → API Center). A test-account token only reads test accounts; apply for Basic access to read the live account.',
      'Optional: GOOGLE_ADS_LOGIN_CUSTOMER_ID = the manager account id when the ad account is accessed through an MCC.',
    ],
    docs: 'https://developers.google.com/google-ads/api/docs/start',
  },
  linkedin_ads: {
    id: 'linkedin_ads',
    label: 'LinkedIn Ads',
    blurb: 'Sponsored Content and Lead Gen Forms. Read via the Marketing API (adAnalytics) after one teammate connects.',
    auth: 'oauth',
    scopes: ['r_ads', 'r_ads_reporting'],
    env: ['LINKEDIN_ADS_CLIENT_ID', 'LINKEDIN_ADS_CLIENT_SECRET', 'LINKEDIN_ADS_ACCOUNT_ID'],
    prerequisites: [
      'The LinkedIn developer app must have the Advertising API product approved (request it under Products; review takes days to weeks).',
      'Add the redirect URL https://salescrm.chipchip.social/api/marketing/connectors/linkedin_ads/callback (and the localhost one for dev) under Auth → Redirect URLs.',
      'The person who clicks Connect must be at least a Viewer on the ad account.',
    ],
    docs: 'https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/ads-reporting',
  },
};

export function isAdProvider(x: string): x is AdProvider {
  return (AD_PROVIDERS as string[]).includes(x);
}

/** What `GET /api/marketing/connectors` returns per provider. */
export interface ConnectorStatus {
  provider: AdProvider;
  auth: 'service_account' | 'oauth';
  /** service_account: env complete; oauth: a token is stored. */
  connected: boolean;
  /** Service-account email or the LinkedIn member who connected. */
  account_label: string | null;
  connected_at: string | null;
  /** Env vars that are missing on the server — empty when the provider can be used. */
  missing_env: string[];
}

// ─── Live report shapes (GET /api/marketing/overview) ───────────────────────

export interface CampaignRow {
  provider: AdProvider;
  campaign_id: string;
  campaign_name: string;
  status: string | null;
  channel: string | null;
  currency: string;
  impressions: number;
  clicks: number;
  /** Money in the account's currency, as a number (platform-reported). */
  spend: number;
  /** Platform-reported conversions; shown greyed as "as reported", never as leads. */
  platform_conversions: number;
  /** LinkedIn Lead Gen Form leads (one-click leads). 0 for Google. */
  platform_leads: number;
}

export interface DayRow { day: string; provider: AdProvider; impressions: number; clicks: number; spend: number; currency: string }

export interface ProviderReport {
  provider: AdProvider;
  ok: boolean;
  error: string | null;
  currency: string | null;
  campaigns: CampaignRow[];
  days: DayRow[];
  fetched_at: string;
}

export interface AdsOverview {
  days: number;
  since: string;
  until: string;
  providers: ProviderReport[];
}

// ─── Date ranges (client-safe) ──────────────────────────────────────────────

export type RangePreset = 'today' | 'yesterday' | 'last_7' | 'this_month' | 'last_month' | 'this_year' | 'last_year' | 'custom';

export const QUICK_PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last_7', label: 'Last 7 days' },
];
export const MORE_PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_year', label: 'This year' },
  { id: 'last_year', label: 'Last year' },
];
export const DEFAULT_PRESET: RangePreset = 'last_7';

/** YYYY-MM-DD of a local calendar date (never UTC — "today" is the viewer's today). */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Inclusive [since, until] for a preset. "Last 7 days" = the 7 closed days before today, like the ad platforms. */
export function presetRange(p: Exclude<RangePreset, 'custom'>, now = new Date()): { since: string; until: string } {
  const d = (y: number, m: number, day: number) => new Date(y, m, day);
  const y = now.getFullYear(), m = now.getMonth(), t = now.getDate();
  switch (p) {
    case 'today': return { since: ymd(now), until: ymd(now) };
    case 'yesterday': { const x = d(y, m, t - 1); return { since: ymd(x), until: ymd(x) }; }
    case 'last_7': return { since: ymd(d(y, m, t - 7)), until: ymd(d(y, m, t - 1)) };
    case 'this_month': return { since: ymd(d(y, m, 1)), until: ymd(now) };
    case 'last_month': return { since: ymd(d(y, m - 1, 1)), until: ymd(d(y, m, 0)) };
    case 'this_year': return { since: ymd(d(y, 0, 1)), until: ymd(now) };
    case 'last_year': return { since: ymd(d(y - 1, 0, 1)), until: ymd(d(y - 1, 11, 31)) };
  }
}

export function presetLabel(p: RangePreset): string {
  return [...QUICK_PRESETS, ...MORE_PRESETS].find((x) => x.id === p)?.label ?? 'Custom range';
}

/** "3 – 9 Oct 2026", "28 Sep – 4 Oct 2026", "18 Oct 2026". */
export function rangeLabel(since: string, until: string): string {
  const a = new Date(`${since}T00:00:00`), b = new Date(`${until}T00:00:00`);
  const day = (x: Date) => x.getDate();
  const mon = (x: Date) => x.toLocaleString('en-GB', { month: 'short' });
  if (since === until) return `${day(a)} ${mon(a)} ${a.getFullYear()}`;
  if (a.getFullYear() !== b.getFullYear()) return `${day(a)} ${mon(a)} ${a.getFullYear()} – ${day(b)} ${mon(b)} ${b.getFullYear()}`;
  if (a.getMonth() !== b.getMonth()) return `${day(a)} ${mon(a)} – ${day(b)} ${mon(b)} ${b.getFullYear()}`;
  return `${day(a)} – ${day(b)} ${mon(b)} ${b.getFullYear()}`;
}

export const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// ─── Campaign drill-down (GET /api/marketing/campaign) ──────────────────────

export interface Metrics {
  spend: number;
  impressions: number;
  clicks: number;
  /** Platform-reported conversions + Lead Gen leads ("results"), never CRM leads. */
  results: number;
}

export interface AdGroupRow extends Metrics {
  id: string;
  name: string;
  status: string;          // platform status, e.g. ENABLED / PAUSED
  active: boolean;
  type: string | null;
}

export interface AdRow extends Metrics {
  id: string;
  name: string;            // ad name, else its first headlines, else "Sponsored post …"
  detail: string | null;   // first description / post reference
  type: string | null;
  status: string;          // human status, e.g. "Enabled", "Paused (ad group paused)", "Not serving: campaign group paused"
  active: boolean;         // would serve now: the ad AND its parents are on
  approval: string | null;
  url: string | null;      // landing page (Google) or the sponsored post (LinkedIn)
  group_id: string | null;
  group_name: string | null;
}

export interface CampaignDetail {
  provider: AdProvider;
  campaign_id: string;
  name: string;
  status: string;
  active: boolean;
  currency: string;
  since: string;
  until: string;
  /** "Search · Target spend" / "Engagement · CPM". */
  setup: string[];
  budget: { amount: number; currency: string; period: 'daily' | 'total' } | null;
  /** LinkedIn's campaign group (the level above the campaign). */
  parent: { label: string; name: string; status: string } | null;
  totals: Metrics;
  days: { day: string; spend: number; impressions: number; clicks: number }[];
  /** Google: ad groups. LinkedIn has no ad-set level → null. */
  groups: AdGroupRow[] | null;
  ads: AdRow[];
  notes: string[];
}
