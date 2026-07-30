/**
 * POST /api/linkedin/claim — bind a just-connected Unipile account to me.
 *
 * Called by /settings/linkedin after Unipile redirects the user back. Using the
 * session this way avoids exposing a public callback endpoint for Unipile's
 * notify_url: the binding is authenticated as the browser user who just
 * completed the flow, not by a shared secret on an internet-facing route.
 *
 * Safety: only accounts connected in the last 15 minutes and not already bound
 * to anyone are claimable, and if more than one qualifies we refuse rather than
 * guess — binding the wrong LinkedIn account to a user would hand them someone
 * else's inbox. (Two people connecting inside the same window is the only way
 * to hit that; with a small team it is rare, and refusing is the safe failure.)
 */
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { listLinkedInAccounts } from '@/lib/unipile';

export const dynamic = 'force-dynamic';

const CLAIM_WINDOW_MS = 15 * 60_000;

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const accounts = await listLinkedInAccounts();
  if ('error' in accounts) return NextResponse.json({ error: accounts.error }, { status: 502 });
  if (accounts.length === 0) {
    return NextResponse.json({ error: 'No LinkedIn account found on Unipile yet.' }, { status: 404 });
  }

  const { rows: bound } = await pool.query<{ unipile_account_id: string; owner_user_id: string }>(
    `SELECT unipile_account_id, owner_user_id FROM linkedin_accounts WHERE revoked_at IS NULL`,
  );
  const boundIds = new Map(bound.map((b) => [b.unipile_account_id, b.owner_user_id]));

  // Already mine? Re-running the flow (or refreshing the page) is a no-op.
  const mine = accounts.find((a) => boundIds.get(a.id) === session.userId);
  if (mine) return NextResponse.json({ claimed: true, already: true, account: mine.name });

  const fresh = accounts.filter((a) => {
    if (boundIds.has(a.id)) return false;
    const created = a.created_at ? Date.parse(a.created_at) : NaN;
    return Number.isFinite(created) && Date.now() - created < CLAIM_WINDOW_MS;
  });

  if (fresh.length === 0) {
    return NextResponse.json(
      { error: 'No newly connected LinkedIn account to claim. Start the connect flow again.' },
      { status: 404 },
    );
  }
  if (fresh.length > 1) {
    return NextResponse.json(
      {
        error:
          'More than one LinkedIn account was connected just now, so we cannot tell which is yours. ' +
          'Wait a minute and try again, or ask an admin to bind it.',
      },
      { status: 409 },
    );
  }

  const acc = fresh[0];
  const im = (acc.connection_params?.im || {}) as Record<string, unknown>;
  try {
    const out = await kernelCall(
      'crm_linkedin_link_account',
      {
        unipile_account_id: acc.id,
        provider_id: (im.id as string) ?? null,
        public_identifier: (im.publicIdentifier as string) ?? null,
        display_name: acc.name ?? (im.username as string) ?? null,
        premium_features: (im.premiumFeatures as string[]) ?? [],
        proxy_country:
          ((im.proxy as Record<string, unknown> | undefined)?.country as string) ?? null,
      },
      session.userId,
    );
    return NextResponse.json({ claimed: true, ...out });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to bind account' },
      { status: 500 },
    );
  }
}
