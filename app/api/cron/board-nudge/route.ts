/**
 * POST /api/cron/board-nudge — post a fresh reminder in the board Telegram
 * group for every pending decision (throttled).
 *
 * Guarded by the same CRON_SECRET as /api/cron. Meant to be hit by a
 * scheduled GitHub Actions workflow at 08:00 UTC on Mon/Wed/Fri (= 11:00
 * EAT). See .github/workflows/board-nudge.yml.
 */
import { NextRequest, NextResponse } from 'next/server';
import { nudgePendingBoardDecisions } from '@/lib/telegram-notifications';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await nudgePendingBoardDecisions();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/board-nudge] failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}

export const POST = GET;
