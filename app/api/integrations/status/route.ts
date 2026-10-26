import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getValidAccessToken } from '@/lib/google-oauth';

/**
 * Which OAuth providers the current user is connected to, for Profile → Google / Imports.
 * For Google it also says what the connection may do (`can`: contacts / read mail / send) and whether it still works:
 * `needs_reconnect` when Google refuses the stored token (revoked, or issued by the old Google project) — checked with
 * the same refresh every sync uses, so "Connected" is only shown for a connection that works.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows } = await pool.query(
    `SELECT provider, account_email, expires_at, scopes, created_at, refresh_token IS NOT NULL AS has_refresh
     FROM oauth_tokens WHERE user_id = $1`,
    [session.userId]
  );

  const providers: Record<string, Record<string, unknown>> = {};
  for (const r of rows) {
    providers[r.provider] = { account_email: r.account_email, expires_at: r.expires_at, has_refresh: r.has_refresh,
      connected_at: r.created_at };
  }
  const g = rows.find((r) => r.provider === 'google');
  if (g) {
    const works = !!(await getValidAccessToken(session.userId));
    const scopes: string[] = g.scopes || [];
    providers.google = {
      ...providers.google,
      needs_reconnect: !works,
      can: { contacts: scopes.includes('contacts.readonly'), read_mail: scopes.includes('gmail.readonly'),
             calendar: scopes.includes('calendar.readonly'),
             send: scopes.includes('gmail.send') },
    };
  }
  return NextResponse.json({ providers });
}
