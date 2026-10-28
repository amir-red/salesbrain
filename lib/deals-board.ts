/**
 * Server side of the Deals page: every deal that is not deleted, with what the board and the list show about it —
 * lead, creator, sales rep (lib/zeami SALES_REP_JOIN), confirmed delivery state, the open board vote and its tally.
 * Org-wide on purpose (the board is team transparency, §5.14); the page narrows to "Mine" client-side.
 * One query, laterals instead of fan-out (session pooler shared with production). Server-only.
 */
import pool from '@/lib/db';
import { SALES_REP_JOIN } from '@/lib/zeami';
import type { DealItem } from '@/lib/deals-view';

export async function loadDeals(): Promise<DealItem[]> {
  const { rows } = await pool.query(
    `SELECT d.id, d.name, d.company, d.deal_type, d.status, d.gate, d.score, d.priority,
            d.value::float AS value, COALESCE(d.currency, 'USD') AS currency,
            d.user_id, c.name AS creator_name, d.lead_id, l.name AS lead_name, rep.name AS rep_name,
            d.gate_entered_at, d.created_at, d.updated_at, d.won_at, d.contract_signed_at,
            FLOOR(EXTRACT(EPOCH FROM (now() - d.gate_entered_at)) / 86400)::int AS days_in_gate,
            dl.status AS delivery_status, dl.health_level AS delivery_health, dl.step_title AS delivery_step,
            bd.gate AS vote_gate, COALESCE(bd.proceed, 0) AS vote_proceed, COALESCE(bd.stop, 0) AS vote_stop,
            bd.votes_required AS vote_required
       FROM deals d
       LEFT JOIN users l ON l.id = d.lead_id
       LEFT JOIN users c ON c.id = d.user_id
       ${SALES_REP_JOIN}
       LEFT JOIN LATERAL (
         SELECT x.status, x.health_level, x.step_title FROM delivery_links x
          WHERE x.deal_id = d.id AND x.confirmed_at IS NOT NULL ORDER BY x.synced_at DESC NULLS LAST LIMIT 1
       ) dl ON true
       LEFT JOIN LATERAL (
         SELECT b.gate, b.votes_required,
                (SELECT count(*)::int FROM board_votes v WHERE v.board_decision_id = b.id AND v.vote = 'proceed') AS proceed,
                (SELECT count(*)::int FROM board_votes v WHERE v.board_decision_id = b.id AND v.vote = 'stop') AS stop
           FROM board_decisions b
          WHERE b.deal_id = d.id AND b.status = 'pending'
          ORDER BY b.created_at DESC LIMIT 1
       ) bd ON true
      WHERE d.deleted_at IS NULL
      ORDER BY d.priority NULLS LAST, d.updated_at DESC`,
  );
  return rows as DealItem[];
}
