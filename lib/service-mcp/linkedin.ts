/**
 * Per-employee LinkedIn onboarding for the service surface.
 *
 * The web app binds LinkedIn to the browser session (app/api/linkedin/{connect,
 * claim}). Here the owner is a provisioned employee's SalesBrain user, so the
 * same two primitives are driven owner-parametrically:
 *   1. linkedin_connect_start → mint a Unipile hosted-auth link.
 *   2. linkedin_link_account  → bind the resulting unipile_account_id to the
 *      owner via crm_linkedin_link_account (owner comes from the actor).
 *
 * We pass the concrete unipile_account_id explicitly rather than reusing the
 * app's "single fresh account in 15 min" recency heuristic (claim/route.ts),
 * which is unsafe with many employees connecting concurrently.
 */

import { kernelCall } from '../mcp/kernel-rpc';
import { unipileFetch, listLinkedInAccounts, type UnipileAccount } from '../unipile';

/**
 * Mint a hosted-auth URL. The sibling app supplies where Unipile should send
 * the employee after success/failure (their own app pages).
 */
export async function linkedinConnectStart(args: {
  success_redirect_url?: string;
  failure_redirect_url?: string;
}): Promise<{ url: string | null; expires_on: string }> {
  const expiresOn = new Date(Date.now() + 15 * 60_000).toISOString();
  const apiUrl = process.env.UNIPILE_DSN?.startsWith('http')
    ? process.env.UNIPILE_DSN
    : `https://${process.env.UNIPILE_DSN}`;
  const res = await unipileFetch('hosted/accounts/link', {
    method: 'POST',
    body: {
      type: 'create',
      providers: ['LINKEDIN'],
      api_url: apiUrl,
      expiresOn,
      success_redirect_url: args.success_redirect_url,
      failure_redirect_url: args.failure_redirect_url,
    },
  });
  if (res.error) throw new Error(String(res.error));
  return { url: (res.url as string) ?? (res.link as string) ?? null, expires_on: expiresOn };
}

/** List unbound LinkedIn accounts on Unipile, so the app can pick the right id. */
export async function linkedinUnboundAccounts(): Promise<
  Array<{ unipile_account_id: string; name: string | null; created_at: string | null }>
> {
  const accounts = await listLinkedInAccounts();
  if ('error' in accounts) throw new Error(accounts.error);
  return accounts.map((a: UnipileAccount) => ({
    unipile_account_id: a.id,
    name: a.name ?? null,
    created_at: a.created_at ?? null,
  }));
}

/**
 * Bind a specific Unipile account to the employee's SalesBrain user. The
 * unipile_account_id must be passed explicitly (from the connect callback or
 * linkedin_unbound_accounts). The kernel refuses to re-bind an id already
 * owned by someone else.
 */
export async function linkedinLinkAccount(
  ownerUserId: string,
  args: { unipile_account_id?: string },
): Promise<Record<string, unknown>> {
  const accountId = (args.unipile_account_id ?? '').trim();
  if (!accountId) throw new Error('unipile_account_id is required');

  // Enrich from the Unipile listing when available (provider id, handle, etc.).
  let im: Record<string, unknown> = {};
  let name: string | null = null;
  const accounts = await listLinkedInAccounts();
  if (!('error' in accounts)) {
    const acc = accounts.find((a: UnipileAccount) => a.id === accountId);
    if (acc) {
      im = (acc.connection_params?.im || {}) as Record<string, unknown>;
      name = acc.name ?? null;
    }
  }
  return kernelCall(
    'crm_linkedin_link_account',
    {
      unipile_account_id: accountId,
      provider_id: (im.id as string) ?? null,
      public_identifier: (im.publicIdentifier as string) ?? null,
      display_name: name ?? (im.username as string) ?? null,
      premium_features: (im.premiumFeatures as string[]) ?? [],
      proxy_country: ((im.proxy as Record<string, unknown> | undefined)?.country as string) ?? null,
    },
    ownerUserId,
  );
}
