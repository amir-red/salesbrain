import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { generateLinkToken } from '@/lib/telegram-links';

/**
 * POST /api/admin/users/[id]/telegram-invite  { send?: boolean }  — admin only.
 *
 * Mints a LONG-lived (7 day) single-use link code for one person and, unless `send` is false,
 * emails them the one-tap link. The code is the only way into the bot: anyone else who messages
 * it is ignored. Linking happens when the person taps the link and presses Start, which sends
 * `/start LINK-…` — the gateway hook binds their Telegram account and lets them chat at once.
 * The raw link is returned too, so an admin can paste it into another channel instead.
 *
 * Whoever holds the link can bind THEIR Telegram to this account, so it goes only to the
 * account's own email address (or is handed over by the admin), and it expires in a week.
 */
export const dynamic = 'force-dynamic';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { send?: boolean };
  const bot = process.env.TELEGRAM_BOT_USERNAME || '';

  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email,
            EXISTS (SELECT 1 FROM telegram_user_links l WHERE l.user_id = u.id AND l.revoked_at IS NULL) AS linked
       FROM users u WHERE u.id = $1`,
    [params.id]
  );
  const user = rows[0];
  if (!user) return NextResponse.json({ error: 'No such user' }, { status: 404 });
  if (user.linked) return NextResponse.json({ error: 'Already on Telegram' }, { status: 409 });
  if (/@.*\.service\.salesbrain$/i.test(user.email)) {
    return NextResponse.json({ error: 'This is an app-provisioned account; it has no mailbox to invite' }, { status: 422 });
  }

  const { raw, row } = await generateLinkToken(user.id, { ttlMs: TTL_MS });
  const link = bot ? `https://t.me/${bot}?start=${raw}` : null;

  let emailed = false;
  let emailError: string | null = null;
  if (body.send !== false) {
    try {
      const hi = user.name ? `Hi ${String(user.name).split(' ')[0]},` : 'Hi,';
      const how = link
        ? `<p><a href="${link}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6C477D;color:#fff;text-decoration:none">Open in Telegram</a></p><p>Tap the button, then press <b>Start</b> in Telegram. That is all.</p>`
        : `<p>Open the SalesBrain bot in Telegram and send this message: <b>/start ${raw}</b></p>`;
      await sendEmail({
        to: user.email,
        subject: 'Connect SalesBrain to your Telegram',
        body: `<p>${hi}</p><p>Connect your Telegram to SalesBrain to get your notifications there and manage your deals, leads and approvals by chat.</p>${how}<p style="color:#666;font-size:12px">This link works once and expires on ${row.expires_at ? new Date(row.expires_at).toLocaleDateString('en-GB') : 'in 7 days'}. If you did not expect this, ignore this email.</p>`,
      });
      emailed = true;
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'email failed';
    }
  }

  await pool
    .query(
      `INSERT INTO agent_audit_log (actor_user_id, command, input, status, detail)
       VALUES ($1, 'telegram_invite', $2, $3, $4)`,
      [session.userId, JSON.stringify({ invitee: user.id, emailed }), emailError ? 'error' : 'success', emailError]
    )
    .catch(() => undefined);

  return NextResponse.json({
    ok: true,
    emailed,
    email_error: emailError,
    link,
    code: link ? undefined : raw,
    expires_at: row.expires_at,
    bot_username: bot || null,
  });
}
