/**
 * Internal API for Telegram linking flow. Used by /settings/telegram.
 *
 *   GET  /api/telegram/link-tokens   → current link status (linked or not) + username display
 *   POST /api/telegram/link-tokens   → generate a fresh linking code (raw shown once)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { generateLinkToken, getCurrentLinkForUser } from '@/lib/telegram-links';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getCurrentLinkForUser(session.userId);
  return NextResponse.json({
    linked: link !== null,
    link: link
      ? {
          telegram_username: link.telegram_username,
          telegram_first_name: link.telegram_first_name,
          telegram_last_name: link.telegram_last_name,
          linked_at: link.linked_at,
        }
      : null,
  });
}

export async function POST(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { raw, row } = await generateLinkToken(session.userId);
  return NextResponse.json({
    raw_token: raw,
    expires_at: row.expires_at,
    bot_username: process.env.TELEGRAM_BOT_USERNAME || null,
  });
}
