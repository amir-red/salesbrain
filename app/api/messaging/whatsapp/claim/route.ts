/**
 * POST /api/messaging/whatsapp/claim — bind a just-connected Unipile WhatsApp account to me (core 100).
 *
 * The safety of lib/linkedin-claim.ts: only WhatsApp accounts connected in the last 15 minutes and not bound to anyone
 * are claimable, and when more than one qualifies we refuse rather than guess (binding the wrong WhatsApp would hand a
 * person someone else's chats). The binding is authenticated as the browser user who just finished the flow.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import pool from '@/lib/db';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { listWhatsAppAccounts } from '@/lib/unipile';

export const dynamic = 'force-dynamic';

const CLAIM_WINDOW_MS = 15 * 60_000;

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const accounts = await listWhatsAppAccounts();
  if ('error' in accounts) return NextResponse.json({ error: accounts.error }, { status: 502 });
  const { rows: bound } = await pool.query<{ unipile_account_id: string; owner_user_id: string }>(
    `SELECT unipile_account_id, owner_user_id FROM messaging_sources
      WHERE unipile_account_id IS NOT NULL AND revoked_at IS NULL`);
  const boundIds = new Map(bound.map((b) => [b.unipile_account_id, b.owner_user_id]));

  const mine = accounts.find((a) => boundIds.get(a.id) === session.userId);
  if (mine) return NextResponse.json({ claimed: true, already: true });

  const fresh = accounts.filter((a) => {
    if (boundIds.has(a.id)) return false;
    const created = a.created_at ? Date.parse(a.created_at) : NaN;
    return Number.isFinite(created) && Date.now() - created < CLAIM_WINDOW_MS;
  });
  if (!fresh.length) {
    return NextResponse.json({ error: 'No newly connected WhatsApp account to claim. Start again from Connect WhatsApp.' }, { status: 404 });
  }
  if (fresh.length > 1) {
    return NextResponse.json({
      error: 'More than one WhatsApp account was connected just now, so we cannot tell which is yours. Wait a minute and try again.',
    }, { status: 409 });
  }
  const acc = fresh[0];
  const im = (acc.connection_params?.im || {}) as Record<string, unknown>;
  const phone = (im.phone_number ?? im.phoneNumber ?? im.username ?? null) as string | null;
  try {
    const out = await kernelCall('messaging_whatsapp_add', { unipile_account_id: acc.id, phone, label: acc.name || 'WhatsApp' }, session.userId);
    if (out.error) return NextResponse.json(out, { status: 400 });
    const synced = await kernelCall('messaging_sync_now', {}, session.userId).catch(() => null);
    return NextResponse.json({ claimed: true, ...out, synced });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
