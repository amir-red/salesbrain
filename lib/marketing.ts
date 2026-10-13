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
