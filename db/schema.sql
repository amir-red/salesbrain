-- SalesBrain PostgreSQL Schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Deals: core CRM entity
CREATE TABLE deals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  company       TEXT NOT NULL,
  contact_name  TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  gate          INTEGER NOT NULL DEFAULT 1 CHECK (gate BETWEEN 1 AND 10),
  gate_entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deal_type     TEXT NOT NULL DEFAULT 'sales' CHECK (deal_type IN ('sales', 'grant')),
  score         INTEGER CHECK (score BETWEEN 0 AND 100),
  risk          TEXT CHECK (risk IN ('low', 'medium', 'high', 'critical')),
  verdict       TEXT CHECK (verdict IN ('STRONG', 'PROCEED_WITH_CAUTION', 'WEAK', 'WALK_AWAY', 'STRONG_FIT', 'WEAK_FIT', 'DO_NOT_PURSUE')),
  fields        JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing       TEXT[] NOT NULL DEFAULT '{}',
  flags         TEXT[] NOT NULL DEFAULT '{}',
  notes         TEXT,
  value         NUMERIC(15,2),
  currency      TEXT DEFAULT 'USD',
  owner         TEXT,
  lead_id       UUID REFERENCES users(id),
  user_id       UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deals_lead_id ON deals (lead_id);
CREATE INDEX idx_deals_user_id ON deals (user_id);
CREATE INDEX idx_deals_type ON deals (deal_type);

-- Conversations: chat history per deal
CREATE TABLE conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool_use', 'tool_result')),
  content    TEXT NOT NULL,
  tool_name  TEXT,
  tool_input JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_deal ON conversations(deal_id, created_at DESC);

-- Gate events: audit trail of gate transitions
CREATE TABLE gate_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_gate  INTEGER NOT NULL,
  to_gate    INTEGER NOT NULL,
  reason     TEXT,
  triggered_by TEXT NOT NULL, -- 'agent', 'board', 'cron'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gate_events_deal ON gate_events(deal_id, created_at DESC);

-- Followups: scheduled emails and reminders
CREATE TABLE followups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('email', 'reminder', 'sla_alert')),
  subject    TEXT,
  body       TEXT NOT NULL,
  to_email   TEXT,
  due_at     TIMESTAMPTZ NOT NULL,
  sent       BOOLEAN NOT NULL DEFAULT false,
  sent_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_followups_due ON followups(due_at) WHERE sent = false;

-- Board decisions: Telegram-based review board votes (multi-voter)
CREATE TABLE board_decisions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id          UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  gate             INTEGER NOT NULL,
  telegram_message_id BIGINT,
  question         TEXT NOT NULL,
  decision         TEXT CHECK (decision IN ('proceed', 'stop', 'amend')),
  decided_by       TEXT,
  decided_at       TIMESTAMPTZ,
  votes_required   INTEGER NOT NULL DEFAULT 5,
  votes_to_block   INTEGER NOT NULL DEFAULT 4,
  total_voters     INTEGER NOT NULL DEFAULT 8,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'amended')),
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_board_decisions_msg ON board_decisions(telegram_message_id) WHERE telegram_message_id IS NOT NULL;

-- Individual board votes from executives
CREATE TABLE board_votes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_decision_id UUID NOT NULL REFERENCES board_decisions(id) ON DELETE CASCADE,
  voter_name        TEXT NOT NULL,
  voter_telegram_id BIGINT,
  vote              TEXT NOT NULL CHECK (vote IN ('proceed', 'stop', 'amend')),
  comment           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(board_decision_id, voter_telegram_id)
);

CREATE INDEX idx_board_votes_decision ON board_votes(board_decision_id);

-- Password reset tokens (hashed, single-use, 1h expiry)
CREATE TABLE password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_password_resets_user ON password_resets(user_id);
CREATE INDEX idx_password_resets_token_hash ON password_resets(token_hash);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
