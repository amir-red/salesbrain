import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isAdProvider, PROVIDER_META } from '@/lib/marketing';

/**
 * Starts the OAuth connect flow for an ad platform.
 *
 * Round 1 ships the contract only: the route verifies the server has every env
 * var the provider needs and answers 501 with the exact list when it does not,
 * so the Connectors page can show the operator what to configure. Round 2 adds
 * the redirect to the provider's consent screen and the callback that writes
 * `oauth_tokens` (see docs/marketing-ads.md §4).
 */
export async function GET(_req: NextRequest, { params }: { params: { provider: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdProvider(params.provider)) return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });

  const meta = PROVIDER_META[params.provider];
  const missing = meta.env.filter((k) => !process.env[k]);
  if (missing.length) {
    return NextResponse.json(
      { error: `${meta.label} is not configured on this server`, missing_env: missing },
      { status: 501 },
    );
  }
  return NextResponse.json(
    { error: `${meta.label} connect flow is not implemented yet (round 2)`, missing_env: [] },
    { status: 501 },
  );
}
