-- Grandfather in-flight sales deals at G7 or beyond when the board review
-- moves from G5 → G7. Without this, the agent would try to retroactively
-- send a board review for deals that already negotiated past G7 under the
-- old policy. Idempotent — safe to re-run.

UPDATE deals
SET flags = array_append(flags, 'board_sent_g7')
WHERE deal_type = 'sales'
  AND gate >= 7
  AND NOT ('board_sent_g7' = ANY(flags));
