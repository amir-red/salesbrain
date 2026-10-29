/**
 * What the LinkedIn connection-request cap still allows an owner right now. Caps follow the account's subscription
 * (`agents.linkedin_connect`: free 15/75, Sales Navigator 25/120) and the windows are ROLLING (last 24 h / last
 * 7 days) — the kernel's policy/invitations.py, mirrored in SQL for the list pages. Server only; runs on the
 * caller's checked-out client (pooler rule: one client, queries in sequence).
 */
import type { PoolClient } from 'pg';

export interface ConnectQuota {
  linkedin: boolean; enabled: boolean; subscription: 'free' | 'sales_navigator';
  per_day: number; per_week: number; no_answer_after_days: number;
  sent_today: number; sent_week: number; queued: number; remaining: number;
  /** When the window is full: the moment enough requests age out of it. */
  next_request_at: string | null;
}

export async function connectQuota(client: PoolClient, ownerId: string): Promise<ConnectQuota> {
  const connect = await client.query(
    `SELECT (SELECT value FROM policy_rules WHERE key = 'agents.linkedin_connect') AS cfg,
            la.id IS NOT NULL AS linkedin, la.id AS account_id,
            COALESCE(la.premium_features::text, '') ILIKE '%sales_navigator%' AS sales_navigator,
            (SELECT count(*)::int FROM linkedin_invitations i
              WHERE i.account_id = la.id AND i.status <> 'failed' AND i.sent_at > now() - interval '24 hours') AS sent_today,
            (SELECT count(*)::int FROM linkedin_invitations i
              WHERE i.account_id = la.id AND i.status <> 'failed' AND i.sent_at > now() - interval '7 days') AS sent_week,
            (SELECT count(*)::int FROM outreach_approvals oa
              WHERE oa.owner_user_id = $1 AND oa.kind = 'connect' AND oa.status IN ('pending', 'approved')) AS queued
       FROM (SELECT 1) one
       LEFT JOIN linkedin_accounts la ON la.owner_user_id = $1 AND la.revoked_at IS NULL`,
    [ownerId]);
  const cc = connect.rows[0] ?? {};
  const raw = { enabled: true, per_day: 5, per_week: 25, no_answer_after_days: 21,
                per_day_sales_navigator: 25, per_week_sales_navigator: 120, ...(cc.cfg ?? {}) };
  const cfg = cc.sales_navigator
    ? { ...raw, per_day: Number(raw.per_day_sales_navigator), per_week: Number(raw.per_week_sales_navigator) }
    : raw;
  let nextAt: string | null = null;
  if (cc.account_id) {
    const waits: string[] = [];
    for (const [n, cap, span] of [[cc.sent_today ?? 0, Number(cfg.per_day), '24 hours'], [cc.sent_week ?? 0, Number(cfg.per_week), '7 days']] as const) {
      if (cap > 0 && n >= cap) {
        const r = await client.query(
          `SELECT (sent_at + interval '${span}') AS t FROM linkedin_invitations
            WHERE account_id = $1 AND status <> 'failed' AND sent_at > now() - interval '${span}'
            ORDER BY sent_at OFFSET $2 LIMIT 1`, [cc.account_id, n - cap]);
        if (r.rows[0]?.t) waits.push(new Date(r.rows[0].t).toISOString());
      }
    }
    nextAt = waits.sort().pop() ?? null;
  }
  const perDay = Number(cfg.per_day), perWeek = Number(cfg.per_week);
  const remaining = cc.linkedin ? Math.max(0, Math.min(perDay - (cc.sent_today ?? 0), perWeek - (cc.sent_week ?? 0))) : 0;
  return {
    linkedin: Boolean(cc.linkedin), enabled: Boolean(cfg.enabled),
    subscription: cc.sales_navigator ? 'sales_navigator' : 'free',
    per_day: perDay, per_week: perWeek, no_answer_after_days: Number(cfg.no_answer_after_days),
    sent_today: cc.sent_today ?? 0, sent_week: cc.sent_week ?? 0, queued: cc.queued ?? 0, remaining,
    next_request_at: nextAt,
  };
}
