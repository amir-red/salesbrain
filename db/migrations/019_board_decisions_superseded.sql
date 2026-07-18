-- Migration 019: mark stale board decisions "superseded".
--
-- Problem: a deal that advances past a gate through a *second*, successful
-- board review leaves the earlier pending row behind in the table. Nothing
-- ever closes those rows, so tooling like `list_pending_board_decisions`
-- surfaces them as if they still need votes.
--
-- Solution:
--   1. Extend the status CHECK constraint to include 'superseded'.
--   2. Backfill: every pending row whose gate is now < the deal's gate is
--      obsolete by definition — the deal has already left that gate. Mark
--      them 'superseded' + set resolved_at so audit trail stays intact.

ALTER TABLE board_decisions
  DROP CONSTRAINT IF EXISTS board_decisions_status_check;

ALTER TABLE board_decisions
  ADD CONSTRAINT board_decisions_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'amended', 'superseded'));

-- One-shot backfill. Safe to re-run — WHERE clause only matches rows still
-- in the wrong state.
UPDATE board_decisions bd
SET status = 'superseded',
    resolved_at = COALESCE(bd.resolved_at, now())
FROM deals d
WHERE bd.deal_id = d.id
  AND bd.status = 'pending'
  AND bd.gate < d.gate;
