import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getValidAccessToken, listGoogleAccounts } from '@/lib/google-oauth';

/**
 * Which OAuth providers the current user is connected to, for Profile → Google / Imports.
 * For Google it also says what the connection may do (`can`: contacts / read mail / send) and whether it still works:
 * `needs_reconnect` when Google refuses the stored token (revoked, or issued by the old Google project) — checked with
 * the same refresh every sync uses, so "Connected" is only shown for a connection that works.
 * core 102: a person may connect several Google accounts — `google_accounts` lists each (default sending one first);
 * `providers.google` stays the default account, for the screens that show one.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows } = await pool.query(
    `SELECT provider, account_email, expires_at, scopes, created_at, refresh_token IS NOT NULL AS has_refresh
     FROM oauth_tokens WHERE user_id = $1`,
    [session.userId]
  );

  const can = (scopes: string[]) => ({ contacts: scopes.includes('contacts.readonly'), read_mail: scopes.includes('gmail.readonly'),
    calendar: scopes.includes('calendar.readonly'), send: scopes.includes('gmail.send'), modify: scopes.includes('gmail.modify') });
  const providers: Record<string, Record<string, unknown>> = {};
  for (const r of rows) {
    if (r.provider === 'google') continue;
    providers[r.provider] = { account_email: r.account_email, expires_at: r.expires_at, has_refresh: r.has_refresh,
      connected_at: r.created_at };
  }
  // One check per account, in sequence (the session pooler is shared with production: no fan-out).
  const google_accounts = [];
  for (const a of await listGoogleAccounts(session.userId)) {
    const works = !!(await getValidAccessToken(session.userId, 'google', a.email));
    google_accounts.push({ account_email: a.email, connected_at: a.connected_at, is_default: a.is_default,
      needs_reconnect: !works, can: can(a.scopes) });
  }
  if (google_accounts.length) {
    const d = google_accounts[0];
    providers.google = { account_email: d.account_email, connected_at: d.connected_at, needs_reconnect: d.needs_reconnect, can: d.can };
  }
  return NextResponse.json({ providers, google_accounts });
}
