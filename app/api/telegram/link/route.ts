/**
 * DELETE /api/telegram/link — revoke the caller's Telegram binding.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { revokeLink } from '@/lib/telegram-links';

export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const revoked = await revokeLink(session.userId);
  return NextResponse.json({ revoked });
}
