import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { adsOverview, adsOverviewRange } from '@/lib/ads/overview';
import { isYmd } from '@/lib/marketing';

const MAX_SPAN_DAYS = 1100;   // three years: "last year" from late December plus slack

/**
 * Live campaign performance — see lib/ads/overview.ts. Org-wide, like /pipeline.
 *   ?since=YYYY-MM-DD&until=YYYY-MM-DD   any inclusive range (until may be today; future days are clamped)
 *   ?days=N                              the last N closed days (legacy)
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const since = q.get('since'), until = q.get('until');
  if (since || until) {
    if (!isYmd(since) || !isYmd(until)) return NextResponse.json({ error: 'since and until must be YYYY-MM-DD' }, { status: 400 });
    if (since > until) return NextResponse.json({ error: 'since is after until' }, { status: 400 });
    const span = (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000 + 1;
    if (span > MAX_SPAN_DAYS) return NextResponse.json({ error: `range is ${span} days; the maximum is ${MAX_SPAN_DAYS}` }, { status: 400 });
    return NextResponse.json(await adsOverviewRange(since, until));
  }
  return NextResponse.json(await adsOverview(Number(q.get('days') || 30)));
}
