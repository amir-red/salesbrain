import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await pool.query(
    `DELETE FROM oauth_tokens WHERE user_id = $1 AND provider = 'google'`,
    [session.userId]
  );
  return NextResponse.json({ disconnected: true });
}
