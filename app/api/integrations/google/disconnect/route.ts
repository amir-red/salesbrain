import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { disconnectGoogle } from '@/lib/google-connect';

/** POST — disconnect the person's Google: contacts/Gmail sync and sending stop together. */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await disconnectGoogle(session.userId);
  return NextResponse.json({ disconnected: true });
}
