-- Migration 018: track when we last nudged a pending board decision.
--
-- The scheduled nudge (cron on Mon/Wed/Fri) and the on-demand
-- `nudge_pending_votes` MCP tool both post a fresh reminder in the board
-- group and rewire `telegram_message_id` to the new message so
-- reply-to-vote keeps working. `last_nudged_at` gives us a 4-hour
-- throttle so accidental double-fires don't spam the group.

ALTER TABLE board_decisions
  ADD COLUMN IF NOT EXISTS last_nudged_at TIMESTAMPTZ;

-- Small partial index scoped to pending decisions — the only rows we
-- ever consider for a nudge. Keeps the scan cheap on the cron path.
CREATE INDEX IF NOT EXISTS idx_board_decisions_pending_nudge
  ON board_decisions (last_nudged_at)
  WHERE status = 'pending';
