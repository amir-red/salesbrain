import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { AD_PROVIDERS, PROVIDER_META, type ConnectorStatus } from '@/lib/marketing';

/**
 * Which ad platforms the current user has connected, and whether the server is
 * configured to start each connect flow. Ad credentials live in `oauth_tokens`
 * next to the Gmail connection, keyed by provider 'google_ads' / 'linkedin_ads'.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows } = await pool.query(
    `SELECT provider, account_email, created_at
       FROM oauth_tokens
      WHERE user_id = $1 AND provider = ANY($2::text[])`,
    [session.userId, AD_PROVIDERS],
  );
  const byProvider = new Map(rows.map((r) => [r.provider as string, r]));

  const connectors: ConnectorStatus[] = AD_PROVIDERS.map((p) => {
    const row = byProvider.get(p);
    return {
      provider: p,
      connected: !!row,
      account_email: row?.account_email ?? null,
      connected_at: row?.created_at ? new Date(row.created_at).toISOString() : null,
      missing_env: PROVIDER_META[p].env.filter((k) => !process.env[k]),
    };
  });
  return NextResponse.json({ connectors });
}
