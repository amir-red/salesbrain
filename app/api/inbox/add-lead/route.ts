/**
 * POST {email, name?, company?, title?, notes?} — add someone from an email conversation as a lead (core 108): a
 * person on the thread our CRM does not know yet (the colleague who answered an introduction). Lands through the
 * kernel's one hand-added path (crm_prospect_add: dedup by address and name, the owner's single list or none, a
 * /sales-leads card), as the signed-in person. Nothing is sent.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { EMAIL_RE } from '@/lib/email-recipients';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const str = (k: string, max: number) => (typeof body[k] === 'string' ? (body[k] as string).trim().slice(0, max) : '');
  const email = str('email', 200).toLowerCase();
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'No email address' }, { status: 400 });
  const name = str('name', 120) || email.split('@')[0].replace(/[._]+/g, ' ');
  const args: Record<string, unknown> = { full_name: name, email, source_detail: 'Inbox: from an email conversation' };
  for (const [k, max] of [['company', 120], ['title', 120], ['notes', 600]] as const) if (str(k, max)) args[k] = str(k, max);
  try {
    const out = await kernelCall('crm_prospect_add', args, session.userId) as Record<string, unknown>;
    if (typeof out.error === 'string') return NextResponse.json({ error: out.error }, { status: 400 });
    return NextResponse.json({ ok: true, ...out });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
