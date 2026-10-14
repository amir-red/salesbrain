import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { adsOverview } from '@/lib/ads/overview';

/** Live campaign performance for the last N days — see lib/ads/overview.ts. Org-wide, like /pipeline. */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const days = Number(req.nextUrl.searchParams.get('days') || 30);
  return NextResponse.json(await adsOverview(days));
}
