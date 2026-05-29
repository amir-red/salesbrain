-- Migration 011: explicit loss state for deals + structured lessons learned
--
-- Two parts:
--
-- 1) deals.status — today the only way a deal "ends" is by reaching the final
--    gate (G9 sales / G10 grants), which we infer as won. There's no concept
--    of "lost." Adding a status field lets us mark a deal lost without
--    making up a fake gate number, and lets the kanban + filters hide
--    losses from the active board.
--
--    We deliberately keep just 'active' | 'lost'. "Won" stays inferred from
--    gate === finalGate so we don't have to backfill 30+ existing deals
--    that are already past G9/G10. If we ever want to make "won" explicit,
--    that's a future migration.
--
-- 2) lessons_learned — when a deal is marked lost, capture a structured
--    lesson (reason, root cause, competitor, lesson for next time) so the
--    org learns from losses and the agent can warn about repeat patterns
--    on similar new deals.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'lost'));

-- Partial index — we mostly query "exclude lost" in the hot path (the kanban),
-- so a partial index on rows that ARE lost keeps the index tiny while
-- accelerating the dedicated "show losses" view.
CREATE INDEX IF NOT EXISTS idx_deals_status_lost
  ON deals(status)
  WHERE status = 'lost';

CREATE TABLE IF NOT EXISTS lessons_learned (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  -- Snapshot of the deal at the moment of loss. We freeze these here so the
  -- lesson stays meaningful even if the deal record is later edited or
  -- deleted. Agent reasoning later filters by deal_type + gate_lost_at +
  -- value, so these fields need to live ON the lesson row.
  deal_type TEXT NOT NULL CHECK (deal_type IN ('sales', 'grant')),
  gate_lost_at SMALLINT NOT NULL,
  value NUMERIC,
  currency TEXT,
  company TEXT NOT NULL,

  -- Free-text "what happened" — the human-readable narrative.
  reason TEXT NOT NULL,

  -- Structured category — enables filtering ("show all losses to price",
  -- "all grants we lost on eligibility") from the /lessons page and the
  -- agent prompt. 'eligibility' covers grant-specific structural mismatches
  -- (donor entity rules, geography, sector, org-age, registration status)
  -- — the door was closed before we ever pitched. Distinct from 'fit'
  -- which is about narrative/intervention mismatch.
  root_cause TEXT NOT NULL CHECK (root_cause IN (
    'price', 'timeline', 'fit', 'decision_maker',
    'capability', 'competition', 'budget', 'eligibility', 'other'
  )),

  -- Optional: who beat us, if known.
  competitor TEXT,

  -- The takeaway — what to do differently next time. This is the
  -- *prescription*; `reason` is the *diagnosis*. The agent surfaces both
  -- on similar new deals.
  lesson TEXT NOT NULL,

  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Filter "lessons matching this deal" needs deal_type + root_cause; ordering
-- by recency makes the "most recent N" agent query trivial.
CREATE INDEX IF NOT EXISTS idx_lessons_deal_type_root_recent
  ON lessons_learned(deal_type, root_cause, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lessons_deal
  ON lessons_learned(deal_id);
