import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getGoogleAuthUrl } from '@/lib/google-oauth';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Use userId as state so callback can associate the token correctly.
    // For CSRF protection in production, sign this with HMAC.
    const url = getGoogleAuthUrl(session.userId);
    return NextResponse.redirect(url);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'OAuth not configured' },
      { status: 500 }
    );
  }
}
