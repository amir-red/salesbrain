-- Pricing tool integration: versioned Excel uploads + per-deal quote snapshots.

CREATE TABLE IF NOT EXISTS pricing_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INT NOT NULL,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  size_bytes INT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  CHECK (version > 0)
);

-- Partial unique index: at most ONE active version at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_tools_one_active
  ON pricing_tools(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_pricing_tools_version_desc
  ON pricing_tools(version DESC);

-- Per-deal (or per what-if) pricing snapshots. inputs/outputs are pure JSON
-- keyed by named range so future Excel renames don't break old quotes.
CREATE TABLE IF NOT EXISTS pricing_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  pricing_tool_id UUID NOT NULL REFERENCES pricing_tools(id),
  created_by UUID NOT NULL REFERENCES users(id),
  inputs JSONB NOT NULL,
  outputs JSONB NOT NULL,
  pnl JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_quotes_deal
  ON pricing_quotes(deal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pricing_quotes_creator
  ON pricing_quotes(created_by, created_at DESC);
