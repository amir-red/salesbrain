/**
 * Act as the lead's owner — server-only.
 *
 * A route lookup, an enrichment or an intro ask is done WITH a specific
 * person's graph and LinkedIn account. When an admin opens someone else's
 * lead, the useful answer is "how does the OWNER reach this person", so the
 * kernel call runs as the owner by default, with a "me" switch. Non-admins
 * always act as themselves. The owner is derived from the prospect row —
 * a client-supplied user id is never trusted.
 *
 * The ring trusts actor_user_id verbatim, so this file is the boundary: it
 * audits the admin → owner hop next to the kernel's own audit rows.
 */
import pool from '@/lib/db';
import type { SessionData } from '@/lib/auth';
import { auditBestEffort } from '@/lib/icp-server';

export type ActAs = 'owner' | 'me';

export interface ActingUser {
  actingUserId: string;
  actingName: string;
  onBehalf: boolean;
  ownerUserId: string | null;
  ownerName: string | null;
  viewerIsAdmin: boolean;
}

export function parseActAs(v: unknown): ActAs {
  return v === 'me' ? 'me' : 'owner';
}

export async function resolveActingUser(
  session: SessionData, prospectId: string, as: ActAs = 'owner', command?: string, audit = true,
): Promise<ActingUser | { error: string; status: 403 | 404 }> {
  const isAdmin = session.role === 'admin';
  const { rows } = await pool.query(
    `SELECT p.owner_user_id, u.name AS owner_name FROM prospects p
       LEFT JOIN users u ON u.id = p.owner_user_id WHERE p.id = $1`, [prospectId]);
  if (!rows[0]) return { error: 'Not found', status: 404 };
  const ownerUserId: string | null = rows[0].owner_user_id;
  const ownerName: string | null = rows[0].owner_name;

  if (!isAdmin) {
    if (ownerUserId && ownerUserId !== session.userId) return { error: 'Not found', status: 404 };
    return { actingUserId: session.userId, actingName: session.name, onBehalf: false, ownerUserId, ownerName, viewerIsAdmin: false };
  }
  const onBehalf = as !== 'me' && !!ownerUserId && ownerUserId !== session.userId;
  if (onBehalf && audit) {
    await auditBestEffort(session.userId, 'act_as', { prospect_id: prospectId, as: ownerUserId, command: command || null });
  }
  return {
    actingUserId: onBehalf ? (ownerUserId as string) : session.userId,
    actingName: onBehalf ? (ownerName || 'the owner') : session.name,
    onBehalf, ownerUserId, ownerName, viewerIsAdmin: true,
  };
}

/** Does this user hold a live LinkedIn account (i.e. can route_expand spend anything)? */
export async function canSource(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM linkedin_accounts WHERE owner_user_id = $1 AND revoked_at IS NULL LIMIT 1`, [userId]);
  return rows.length > 0;
}
