/**
 * POST /api/messaging/whatsapp — a one-time Unipile hosted-auth link to connect MY WhatsApp (core 100). The person
 * scans the QR code on Unipile's page, never ours; we only ever hold an opaque account id. Coming back,
 * Profile → Messaging calls /api/messaging/whatsapp/claim to bind the new account to the session's user.
 * Same pattern as /api/linkedin/connect.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { publicUrl } from '@/lib/public-url';
import { unipileFetch } from '@/lib/unipile';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // NOT req.nextUrl.origin: behind the proxy that is the internal bind, and the person would land on a dead page.
  const back = (q: string) => publicUrl(req, `/profile?tab=messaging&${q}`).toString();
  // Short-lived: a stale link is a stale invitation to bind an account to the wrong person.
  const expiresOn = new Date(Date.now() + 15 * 60_000).toISOString();
  const res = await unipileFetch('hosted/accounts/link', {
    method: 'POST',
    body: {
      type: 'create',
      providers: ['WHATSAPP'],
      api_url: process.env.UNIPILE_DSN?.startsWith('http') ? process.env.UNIPILE_DSN : `https://${process.env.UNIPILE_DSN}`,
      expiresOn,
      name: session.userId,
      success_redirect_url: back('wa=connected'),
      failure_redirect_url: back('wa=failed'),
    },
  });
  if (res.error) return NextResponse.json({ error: res.error }, { status: 502 });
  return NextResponse.json({ url: res.url ?? res.link ?? null, expires_on: expiresOn });
}
