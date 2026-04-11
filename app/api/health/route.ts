import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET() {
  let dbStatus = 'disconnected';

  try {
    const { rows } = await pool.query('SELECT 1 as ok');
    if (rows[0]?.ok === 1) dbStatus = 'connected';
  } catch {
    dbStatus = 'error';
  }

  const status = dbStatus === 'connected' ? 'ok' : 'degraded';

  return NextResponse.json(
    { status, db: dbStatus, timestamp: new Date().toISOString() },
    { status: dbStatus === 'connected' ? 200 : 503 }
  );
}
