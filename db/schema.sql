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

-- Chat file attachments (meeting transcripts, pitch decks, emails, etc.)
CREATE TABLE file_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  extracted_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_file_attachments_deal ON file_attachments(deal_id);
CREATE INDEX idx_file_attachments_user ON file_attachments(user_id);

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

-- ─── Client Onboarding (post-G9) ─────────────────────────────────
-- See db/migrations/003_client_onboardings.sql for the full definition.

CREATE TABLE IF NOT EXISTS client_onboardings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
  pm_user_id UUID REFERENCES users(id),
  assistant_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  stage SMALLINT NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 8),
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'paused')),
  company_name TEXT NOT NULL,
  website TEXT, company_size TEXT, description TEXT,
  executive_name TEXT, executive_email TEXT, executive_role TEXT,
  project_manager_name TEXT, project_manager_email TEXT,
  it_admin_name TEXT, it_admin_email TEXT,
  primary_contact_email TEXT,
  deployment_plan TEXT CHECK (deployment_plan IN ('on_premise', 'saas_cloud')),
  server_setup_done BOOLEAN NOT NULL DEFAULT false,
  app_setup_done    BOOLEAN NOT NULL DEFAULT false,
  download_url TEXT, app_credentials TEXT, email_sent_at TIMESTAMPTZ,
  briefing_meeting_at TIMESTAMPTZ, briefing_notes TEXT,
  employee_count INT, employee_setup_notes TEXT,
  deployment_started_at TIMESTAMPTZ,
  audit_started_at TIMESTAMPTZ, audit_notes TEXT,
  pnl_ready_at TIMESTAMPTZ, pnl_report_url TEXT,
  stage1_completed_at TIMESTAMPTZ, stage2_completed_at TIMESTAMPTZ,
  stage3_completed_at TIMESTAMPTZ, stage4_completed_at TIMESTAMPTZ,
  stage5_completed_at TIMESTAMPTZ, stage6_completed_at TIMESTAMPTZ,
  stage7_completed_at TIMESTAMPTZ, stage8_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboardings_pm ON client_onboardings(pm_user_id);
CREATE INDEX IF NOT EXISTS idx_onboardings_assistant ON client_onboardings(assistant_user_id);
CREATE INDEX IF NOT EXISTS idx_onboardings_stage ON client_onboardings(stage);
CREATE TRIGGER onboardings_updated_at
  BEFORE UPDATE ON client_onboardings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS onboarding_form_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id UUID NOT NULL REFERENCES client_onboardings(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_links_token_hash ON onboarding_form_links(token_hash);
CREATE INDEX IF NOT EXISTS idx_onboarding_links_onboarding ON onboarding_form_links(onboarding_id);

-- ─── Pricing tool integration ────────────────────────────────────
-- See db/migrations/008_pricing.sql for full definition + comments.

CREATE TABLE IF NOT EXISTS pricing_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INT NOT NULL, filename TEXT NOT NULL, storage_path TEXT NOT NULL,
  size_bytes INT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT false, notes TEXT,
  CHECK (version > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_tools_one_active
  ON pricing_tools(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_pricing_tools_version_desc ON pricing_tools(version DESC);

CREATE TABLE IF NOT EXISTS pricing_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  pricing_tool_id UUID NOT NULL REFERENCES pricing_tools(id),
  created_by UUID NOT NULL REFERENCES users(id),
  inputs JSONB NOT NULL, outputs JSONB NOT NULL, pnl JSONB, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pricing_quotes_deal ON pricing_quotes(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_quotes_creator ON pricing_quotes(created_by, created_at DESC);
-- Sales leads: lightweight intake from external "Request Demo" forms
-- (initially zeami.io). Captures the form submission as-is; manual triage
-- from the /sales-leads page converts a lead into a G1 sales deal.
--
-- One submission = one row. No de-duplication on email/company (a single
-- person legitimately requests demos from multiple browsers / for multiple
-- companies); duplicates are surfaced in the UI but not blocked.

CREATE TABLE IF NOT EXISTS sales_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  company TEXT NOT NULL,
  email TEXT NOT NULL,
  description TEXT,                          -- optional free-text from the form

  -- Where did this lead come from? Free text so we can branch in the future
  -- (zeami.io demo form / chipchip.social waitlist / cold reply / etc.)
  source TEXT NOT NULL DEFAULT 'zeami.io:request-demo',

  -- Triage state. 'new' is the inbox; 'converted' means a deal was created;
  -- 'archived' is the "not worth pursuing" graveyard.
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'converted', 'archived')),

  -- Set when status flips to 'converted' — link to the deal we created.
  converted_deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  converted_by UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Raw payload (headers / extra fields) for debugging if the form ever
  -- evolves and we want to inspect what the source actually sent.
  raw_payload JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_leads_status_created
  ON sales_leads(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_leads_email
  ON sales_leads(lower(email));
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
