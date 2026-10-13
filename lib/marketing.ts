/**
 * Marketing (paid ads) — client-safe vocabulary shared by /marketing pages and
 * /api/marketing routes. No DB or IO imports here.
 *
 * Each connector is an OAuth-connected ad platform whose performance data the
 * CRM pulls (read-only). Credentials land in `oauth_tokens` under the provider
 * key below, so the same table that holds the Gmail connection holds these.
 */

export type AdProvider = 'google_ads' | 'linkedin_ads';

export const AD_PROVIDERS: AdProvider[] = ['google_ads', 'linkedin_ads'];

export interface ProviderMeta {
  id: AdProvider;
  label: string;
  blurb: string;
  /** OAuth scopes the connect flow requests (read-only reporting). */
  scopes: string[];
  /** Server env vars the connect route needs before it can start the flow. */
  env: string[];
  /** Operator prerequisites outside this codebase. */
  prerequisites: string[];
  docs: string;
}

export const PROVIDER_META: Record<AdProvider, ProviderMeta> = {
  google_ads: {
    id: 'google_ads',
    label: 'Google Ads',
    blurb: 'Search, Performance Max and Display campaigns. Pulled daily via the Google Ads API (GAQL).',
    scopes: ['https://www.googleapis.com/auth/adwords'],
    env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID'],
    prerequisites: [
      'A Google Ads manager (MCC) account that holds the Zeami ad account.',
      'Developer token approved for at least Basic access (apply from the MCC → API Center).',
      'Enable the Google Ads API on the same Google Cloud project as the Gmail OAuth client, and add the adwords scope to the consent screen.',
    ],
    docs: 'https://developers.google.com/google-ads/api/docs/start',
  },
  linkedin_ads: {
    id: 'linkedin_ads',
    label: 'LinkedIn Ads',
    blurb: 'Sponsored Content and Lead Gen Forms. Pulled daily via the Marketing API (adAnalytics).',
    scopes: ['r_ads', 'r_ads_reporting', 'r_organization_social'],
    env: ['LINKEDIN_ADS_CLIENT_ID', 'LINKEDIN_ADS_CLIENT_SECRET', 'LINKEDIN_ADS_REDIRECT_URI'],
    prerequisites: [
      'A LinkedIn Developer app owned by the Zeami company page.',
      'Apply for the Advertising API product (review takes days to weeks; Community Management is not enough).',
      'The connecting user must be at least a Viewer on the ad account.',
    ],
    docs: 'https://learn.microsoft.com/en-us/linkedin/marketing/',
  },
};

export function isAdProvider(x: string): x is AdProvider {
  return (AD_PROVIDERS as string[]).includes(x);
}

/** What `GET /api/marketing/connectors` returns per provider. */
export interface ConnectorStatus {
  provider: AdProvider;
  connected: boolean;
  account_email: string | null;
  connected_at: string | null;
  /** Env vars that are missing on the server — empty when the flow can start. */
  missing_env: string[];
}
