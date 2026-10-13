import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { ConnectorStatus } from '@/lib/marketing';
import { googleAdsEnvMissing, serviceAccount } from '@/lib/ads/google';
import { linkedInAdsEnvMissing } from '@/lib/ads/linkedin';

/**
 * Connector state for the org. Google Ads is a service account configured in
 * env (connected = env complete); LinkedIn Ads is connected when any teammate's
 * token is stored (the ad account is the company's, so one token serves all).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows } = await pool.query(
    `SELECT account_email, created_at FROM oauth_tokens WHERE provider = 'linkedin_ads' ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1`,
  );
  const li = rows[0];
  const gMissing = googleAdsEnvMissing();

  const connectors: ConnectorStatus[] = [
    {
      provider: 'google_ads', auth: 'service_account',
      connected: gMissing.length === 0,
      account_label: serviceAccount()?.client_email ?? null,
      connected_at: null,
      missing_env: gMissing,
    },
    {
      provider: 'linkedin_ads', auth: 'oauth',
      connected: !!li,
      account_label: li?.account_email ?? null,
      connected_at: li?.created_at ? new Date(li.created_at).toISOString() : null,
      missing_env: linkedInAdsEnvMissing(),
    },
  ];
  return NextResponse.json({ connectors });
}
