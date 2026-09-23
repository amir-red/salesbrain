/**
 * Board-nudge helper for the Telegram bot (the `nudge_pending_votes` MCP tool).
 *
 * The SLA-breach and deal-assigned pushes that used to live here died with the
 * in-app agent runtime and its cron (Phase 5, 2026-07); the daily nudge now runs
 * ring-side (salesbrain-hermes assets/scripts/board_nudge.py). Fire-and-forget:
 * never throws — the CRM's own state has already been persisted.
 */

import pool from './db';
import { sendChatMessage, sendTelegramMessage, formatBoardNudge, type BoardNudgeInput } from './telegram';

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
  const clauses: string[] = [`bd.status = 'pending'`, `d.deleted_at IS NULL`, `bd.gate >= d.gate`];

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
