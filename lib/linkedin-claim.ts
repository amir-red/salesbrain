/**
 * Bind a just-connected Unipile LinkedIn account to a person. Shared by the browser claim route (session-authed)
 * and the Telegram connect flow (identity = the connect token). Server-only.
 *
 * Safety (unchanged from the route this came from): only accounts connected in the last 15 minutes and not
 * already bound to anyone are claimable, and if more than one qualifies we REFUSE rather than guess — binding
 * the wrong LinkedIn account to a person would hand them someone else's inbox. (Two people connecting inside
 * the same window is the only way to hit that; with a small team it is rare, and refusing is the safe failure.)
 */
import pool from '@/lib/db';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { listLinkedInAccounts } from '@/lib/unipile';

const CLAIM_WINDOW_MS = 15 * 60_000;

export async function claimLinkedInForUser(userId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const accounts = await listLinkedInAccounts();
  if ('error' in accounts) return { status: 502, body: { error: accounts.error } };
  if (accounts.length === 0) {
    return { status: 404, body: { error: 'No LinkedIn account found on Unipile yet.' } };
  }

  const { rows: bound } = await pool.query<{ unipile_account_id: string; owner_user_id: string }>(
    `SELECT unipile_account_id, owner_user_id FROM linkedin_accounts WHERE revoked_at IS NULL`,
  );
  const boundIds = new Map(bound.map((b) => [b.unipile_account_id, b.owner_user_id]));

  // Already mine? Re-running the flow (or refreshing the page) is a no-op.
  const mine = accounts.find((a) => boundIds.get(a.id) === userId);
  if (mine) return { status: 200, body: { claimed: true, already: true, account: mine.name } };

  const fresh = accounts.filter((a) => {
    if (boundIds.has(a.id)) return false;
    const created = a.created_at ? Date.parse(a.created_at) : NaN;
    return Number.isFinite(created) && Date.now() - created < CLAIM_WINDOW_MS;
  });

  if (fresh.length === 0) {
    return { status: 404, body: { error: 'No newly connected LinkedIn account to claim. Start the connect flow again.' } };
  }
  if (fresh.length > 1) {
    return {
      status: 409,
      body: {
        error:
          'More than one LinkedIn account was connected just now, so we cannot tell which is yours. ' +
          'Wait a minute and try again, or ask an admin to bind it.',
      },
    };
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
      userId,
    );
    return { status: 200, body: { claimed: true, ...out } };
  } catch (err) {
    return { status: 500, body: { error: err instanceof Error ? err.message : 'Failed to bind account' } };
  }
}
