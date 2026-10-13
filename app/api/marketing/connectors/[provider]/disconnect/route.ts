import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isAdProvider } from '@/lib/marketing';

/** Removes the user's stored credentials for an ad platform. Pulled metrics (round 2) are kept. */
export async function POST(_req: NextRequest, { params }: { params: { provider: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdProvider(params.provider)) return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });

  await pool.query(`DELETE FROM oauth_tokens WHERE user_id = $1 AND provider = $2`, [session.userId, params.provider]);
  return NextResponse.json({ ok: true });
}
