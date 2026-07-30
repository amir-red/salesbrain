/**
 * LinkedIn connection flow (Unipile hosted auth). Used by /settings/linkedin.
 *
 *   GET    /api/linkedin/connect  → is a LinkedIn account connected for me?
 *   POST   /api/linkedin/connect  → mint a one-time hosted-auth URL
 *   DELETE /api/linkedin/connect  → disconnect my account
 *
 * The user types their LinkedIn password into Unipile's page, never into us —
 * we only ever hold an opaque account id. Session-authed throughout, so the
 * per-user scope is the browser session, not anything the client sends.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { unipileFetch } from '@/lib/unipile';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const status = await kernelCall('crm_linkedin_status', {}, session.userId);
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const origin = req.nextUrl.origin;
  // Short-lived by design: Unipile expires all links daily anyway, and a stale
  // link is a stale invitation to bind an account to the wrong person.
  const expiresOn = new Date(Date.now() + 15 * 60_000).toISOString();

  const res = await unipileFetch('hosted/accounts/link', {
    method: 'POST',
    body: {
      type: 'create',
      providers: ['LINKEDIN'],
      api_url: process.env.UNIPILE_DSN?.startsWith('http')
        ? process.env.UNIPILE_DSN
        : `https://${process.env.UNIPILE_DSN}`,
      expiresOn,
      name: session.userId,
      success_redirect_url: `${origin}/settings/linkedin?connected=1`,
      failure_redirect_url: `${origin}/settings/linkedin?failed=1`,
    },
  });
  if (res.error) return NextResponse.json({ error: res.error }, { status: 502 });

  return NextResponse.json({ url: res.url ?? res.link ?? null, expires_on: expiresOn });
}

export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const out = await kernelCall('crm_linkedin_revoke', {}, session.userId);
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
