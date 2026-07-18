/**
 * Push-notification helpers for the Telegram bot.
 *
 *   - notifySlaBreach: called from the cron (once per day) to ping linked
 *     users about their deals that just breached SLA.
 *   - notifyDealAssigned: called from update_deal + create_deal paths when
 *     `lead_id` changes / is set for the first time.
 *
 * Both are fire-and-forget: never throw. If the linked user has no
 * active binding OR Telegram fails, we log and move on — the CRM's own
 * state has already been persisted.
 */

import pool from './db';
import { sendChatMessage, sendTelegramMessage, formatBoardNudge, type BoardNudgeInput } from './telegram';

export interface DealSummaryForNotification {
  id: string;
  name: string;
  company: string;
  gate: number;
  gate_name?: string | null;
  score: number | null;
  risk: string | null;
  days_in_gate?: number;
  sla_days?: number;
}

/**
 * Send a "new deal assigned to you" ping to the user assigned as lead_id.
 * No-op if that user hasn't linked Telegram.
 */
export async function notifyDealAssigned(
  userId: string,
  deal: DealSummaryForNotification,
  assignedByName?: string,
): Promise<void> {
  const { rows } = await pool.query<{ chat_id: string }>(
    `SELECT telegram_chat_id::text AS chat_id
     FROM telegram_user_links
     WHERE user_id = $1 AND revoked_at IS NULL LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) return;

  const chatId = rows[0].chat_id;
  const gateStr = deal.gate_name ? `G${deal.gate}: ${deal.gate_name}` : `G${deal.gate}`;
  const scoreStr = deal.score !== null ? ` · score ${deal.score}` : '';
  const riskStr = deal.risk ? ` · ${deal.risk} risk` : '';

  const lines = [
    `📌 New deal assigned to you`,
    ``,
    `${deal.name}`,
    `${deal.company}`,
    `${gateStr}${scoreStr}${riskStr}`,
  ];
  if (assignedByName) lines.push(``, `Assigned by ${assignedByName}`);
  lines.push(``, `Open: https://salescrm.chipchip.social/deals/${deal.id}`);

  try {
    await sendChatMessage(chatId, lines.join('\n'));
  } catch (err) {
    console.warn('[telegram-notifications] deal-assigned send failed:', err);
  }
}

/**
 * Batched SLA-breach notification. Called from the daily cron. Groups
 * multiple breaches per user into one message so we don't spam.
 */
export async function notifySlaBreachesForAllUsers(): Promise<{ notified: number; deals: number }> {
  // Find every deal that's over its gate's SLA AND is assigned to a user
  // who is linked to Telegram. Group by user_id.
  const { rows } = await pool.query<{
    user_id: string;
    chat_id: string;
    deal_id: string;
    deal_name: string;
    company: string;
    gate: number;
    days_in_gate: number;
  }>(`
    WITH deals_with_sla AS (
      SELECT d.id, d.name, d.company, d.gate, d.lead_id,
             FLOOR(EXTRACT(EPOCH FROM (now() - d.gate_entered_at))/86400)::int AS days_in_gate
      FROM deals d
      WHERE d.status = 'active'
        AND d.lead_id IS NOT NULL
    )
    SELECT d.lead_id AS user_id, l.telegram_chat_id::text AS chat_id,
           d.id AS deal_id, d.name AS deal_name, d.company, d.gate, d.days_in_gate
    FROM deals_with_sla d
    JOIN telegram_user_links l ON l.user_id = d.lead_id AND l.revoked_at IS NULL
    ORDER BY d.lead_id, d.gate, d.days_in_gate DESC
  `);

  // Group by user_id
  const byUser = new Map<string, {
    chatId: string;
    breaches: Array<{ deal_id: string; deal_name: string; company: string; gate: number; days_in_gate: number; sla_days: number }>;
  }>();

  // We need to know sla_days per gate — import lazily to avoid a circular dep.
  const { SALES_GATES, GRANT_GATES } = await import('./gates');

  for (const row of rows) {
    // Naive: try both pipelines and pick whichever has the gate. Deal-type
    // isn't in the SELECT above — we resolve by presence in gates arrays.
    const gate =
      SALES_GATES.find((g) => g.number === row.gate) ||
      GRANT_GATES.find((g) => g.number === row.gate);
    const slaDays = gate?.slaDays ?? 0;
    if (slaDays === 0 || row.days_in_gate <= slaDays) continue;   // not breached

    if (!byUser.has(row.user_id)) {
      byUser.set(row.user_id, { chatId: row.chat_id, breaches: [] });
    }
    byUser.get(row.user_id)!.breaches.push({
      deal_id: row.deal_id,
      deal_name: row.deal_name,
      company: row.company,
      gate: row.gate,
      days_in_gate: row.days_in_gate,
      sla_days: slaDays,
    });
  }

  let notified = 0;
  let totalDeals = 0;
  for (const { chatId, breaches } of byUser.values()) {
    if (breaches.length === 0) continue;
    const lines = [
      `⚠️ ${breaches.length} deal${breaches.length === 1 ? '' : 's'} past SLA`,
      ``,
    ];
    for (const b of breaches.slice(0, 5)) {
      lines.push(`• ${b.deal_name} (${b.company}) — G${b.gate}, ${b.days_in_gate}d / ${b.sla_days}d SLA`);
      lines.push(`  https://salescrm.chipchip.social/deals/${b.deal_id}`);
    }
    if (breaches.length > 5) lines.push(`… and ${breaches.length - 5} more`);

    try {
      await sendChatMessage(chatId, lines.join('\n'));
      notified++;
      totalDeals += breaches.length;
    } catch (err) {
      console.warn('[telegram-notifications] SLA-breach send failed:', err);
    }
  }

  return { notified, deals: totalDeals };
}

// ─── Board-vote nudge ────────────────────────────────────────────

interface PendingDecisionRow {
  id: string;
  gate: number;
  votes_required: number;
  votes_to_block: number;
  total_voters: number;
  created_at: string;
  last_nudged_at: string | null;
  deal_id: string;
  deal_name: string;
  company: string;
  value: string | null;
  currency: string | null;
  voters: Array<{ name: string; vote: 'proceed' | 'stop' | 'amend' }>;
}

/**
 * Post a fresh reminder to the board Telegram group for each pending
 * decision, and rewire `board_decisions.telegram_message_id` to the new
 * message so future replies-to-that-message land in Route 2 the normal
 * way.
 *
 * Defaults:
 *   - Skip decisions younger than 6 hours (let the original run its course).
 *   - Skip decisions nudged in the last 4 hours (throttle).
 *   - `force: true` bypasses both age filters — used by the on-demand
 *     `nudge_pending_votes` MCP tool.
 *   - `onlyDealId` narrows to a single deal.
 *
 * Never throws — logs and moves on. Returns which deals got nudged.
 */
export async function nudgePendingBoardDecisions(
  opts: { onlyDealId?: string; force?: boolean } = {},
): Promise<{ nudged: number; deal_ids: string[]; skipped: number }> {
  const { onlyDealId, force = false } = opts;

  const params: unknown[] = [];
  const clauses: string[] = [`bd.status = 'pending'`, `d.deleted_at IS NULL`];

  if (!force) {
    clauses.push(`bd.created_at < now() - interval '6 hours'`);
    clauses.push(`(bd.last_nudged_at IS NULL OR bd.last_nudged_at < now() - interval '4 hours')`);
  }
  if (onlyDealId) {
    params.push(onlyDealId);
    clauses.push(`d.id = $${params.length}`);
  }

  const { rows } = await pool.query<PendingDecisionRow>(
    `SELECT bd.id, bd.gate, bd.votes_required, bd.votes_to_block, bd.total_voters,
            bd.created_at, bd.last_nudged_at,
            d.id AS deal_id, d.name AS deal_name, d.company, d.value::text AS value, d.currency,
            COALESCE(
              json_agg(
                json_build_object('name', bv.voter_name, 'vote', bv.vote)
                ORDER BY bv.created_at
              ) FILTER (WHERE bv.id IS NOT NULL),
              '[]'::json
            ) AS voters
     FROM board_decisions bd
     JOIN deals d ON d.id = bd.deal_id
     LEFT JOIN board_votes bv ON bv.board_decision_id = bd.id
     WHERE ${clauses.join(' AND ')}
     GROUP BY bd.id, d.id
     ORDER BY bd.created_at ASC`,
    params,
  );

  const nudged: string[] = [];
  let skipped = 0;

  for (const row of rows) {
    const tally = { proceed: 0, stop: 0, amend: 0 };
    for (const v of row.voters) tally[v.vote] = (tally[v.vote] ?? 0) + 1;
    const daysPending = Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86400000);

    const nudge: BoardNudgeInput = {
      deal_name: row.deal_name,
      company: row.company,
      gate: row.gate,
      value: row.value,
      currency: row.currency,
      tally,
      votes_required: row.votes_required,
      votes_to_block: row.votes_to_block,
      total_voters: row.total_voters,
      voters: row.voters,
      days_pending: daysPending,
    };

    try {
      const { messageId } = await sendTelegramMessage(formatBoardNudge(nudge));
      await pool.query(
        `UPDATE board_decisions
         SET telegram_message_id = $1, last_nudged_at = now()
         WHERE id = $2`,
        [messageId, row.id],
      );
      nudged.push(row.deal_id);
    } catch (err) {
      console.error(`[Nudge] failed to post reminder for deal ${row.deal_id}:`, err);
      skipped++;
    }
  }

  console.log(`[Nudge] posted ${nudged.length} reminder(s), skipped ${skipped}`);
  return { nudged: nudged.length, deal_ids: nudged, skipped };
}
