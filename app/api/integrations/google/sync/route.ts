import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { runGoogleSync } from '@/lib/google-sync';

/**
 * POST body: { mode: 'contacts' | 'messages' | 'both', contact_id?: string, max?: number }
 * The work lives in lib/google-sync.ts (shared with the Telegram bridge). Returns stats plus an `errors[]`
 * array of human-readable messages so the UI can show what actually went wrong.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: { mode?: string; contact_id?: string; max?: number } = await req.json().catch(() => ({}));
  const out = await runGoogleSync(session.userId, body);
  if ('error' in out) return NextResponse.json(out, { status: 400 });
  return NextResponse.json(out);
}
