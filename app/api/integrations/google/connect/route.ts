import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getGoogleAuthUrl } from '@/lib/google-oauth';
import { signState } from '@/lib/signed-state';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Signed, expiring state (it used to be the bare user id, which anyone who knew an id could forge).
    const url = getGoogleAuthUrl(signState({ uid: session.userId }));
    return NextResponse.redirect(url);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'OAuth not configured' },
      { status: 500 }
    );
  }
}
