import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { disconnectGoogle } from '@/lib/google-connect';

/** POST /api/email/disconnect — kept for old callers: the same as disconnecting Google (sending is part of it). */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await disconnectGoogle(session.userId);
  return NextResponse.json({ disconnected: true });
}
