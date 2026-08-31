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
  deal_type     TEXT NOT NULL DEFAULT 'sales' CHECK (deal_type IN ('sales', 'grant', 'ai_credit')),
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
  deal_type TEXT NOT NULL CHECK (deal_type IN ('sales', 'grant', 'ai_credit')),
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
-- Migration 012: capture preferred demo date/time/timezone on the
-- public "Request Demo" form at zeami.io.
--
-- Three separate columns (not one TIMESTAMPTZ) so we preserve the
-- prospect's original intent exactly — "9:00 AM in Africa/Nairobi" —
-- instead of converting to UTC at intake. The IANA timezone string
-- lets us render the demo time correctly in the CRM regardless of
-- the rep's own browser timezone.
--
-- No CHECK on the timezone string: IANA renames/deprecates zones
-- occasionally and a DB-level validation drifts. The API validates
-- format at intake instead; junk strings fall through gracefully
-- since Intl.DateTimeFormat ignores unknown zones at render time.

ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS preferred_demo_date DATE,
  ADD COLUMN IF NOT EXISTS preferred_demo_time TIME,
  ADD COLUMN IF NOT EXISTS preferred_demo_timezone TEXT;
-- Migration 013: Calendly booking columns on sales_leads.
--
-- Two-phase rollout:
--   Phase 1 (Calendly Free): rows are created by the form POST; these
--     columns stay NULL because Free doesn't send webhooks.
--   Phase 2 (Calendly Standard): the webhook at /api/public/calendly-webhook
--     fills these on every invitee.created / invitee.canceled event.
--
-- Design notes:
--   - calendly_event_uuid is UNIQUE so re-delivered webhooks (Calendly retries
--     with exponential backoff on non-2xx responses) can't create duplicate
--     rows. Reschedule uses a new uuid so we UPDATE by (email + status) match
--     in the handler rather than a straight ON CONFLICT.
--   - We keep preferred_demo_date/time/timezone alive — the old form flow
--     might still be used for campaigns without the Calendly embed.

ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS calendly_event_uuid TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS calendly_invitee_uuid TEXT,
  ADD COLUMN IF NOT EXISTS meet_link TEXT,
  ADD COLUMN IF NOT EXISTS reschedule_url TEXT,
  ADD COLUMN IF NOT EXISTS cancel_url TEXT,
  ADD COLUMN IF NOT EXISTS booked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS booking_status TEXT
    CHECK (booking_status IN ('scheduled', 'canceled', 'no_show'));

CREATE INDEX IF NOT EXISTS idx_sales_leads_calendly_event
  ON sales_leads(calendly_event_uuid);
CREATE INDEX IF NOT EXISTS idx_sales_leads_booking_status
  ON sales_leads(booking_status)
  WHERE booking_status IS NOT NULL;
-- Migration 014: capture prospect's website when Calendly asks for it.
--
-- Calendly's booking form has been extended to ask three custom questions:
--   1. Company (required)
--   2. Website
--   3. Company Description (optional)
--
-- The webhook parser writes:
--   - Company        → sales_leads.company           (existing column)
--   - Website        → sales_leads.website           (new column, this migration)
--   - Description    → sales_leads.description       (existing column, COALESCE
--                       so we don't overwrite a description captured earlier
--                       via the zeami.io form)
--
-- Same field name as `client_onboardings.website` so the two tables stay
-- schema-consistent for prospect/client basics.

ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS website TEXT;
-- Migration 015: MCP (Model Context Protocol) server infrastructure.
--
-- Two tables:
--   1. mcp_tokens      — per-user bearer tokens (SHA-256 hashed) that let
--                        external MCP clients (Hermes, Claude Desktop, etc.)
--                        act on a user's behalf. Raw token is shown once
--                        at creation and never re-displayable.
--   2. mcp_audit_log   — one row per tool invocation for post-hoc review
--                        of "what did Hermes do?"
--
-- Design decisions:
--   - token_hash is UNIQUE — the auth check is a single indexed lookup.
--   - token_prefix (first 8 chars of the raw token) is stored plaintext
--     so the settings UI can display "mcp_a1b2..." without exposing the
--     full secret. Prefix collisions across users are fine (it's for
--     display, not identity).
--   - revoked_at (nullable) enables soft delete — we keep the row so
--     old audit-log entries can still resolve the token_id foreign key,
--     but skip revoked rows in every auth lookup.
--   - user_id ON DELETE CASCADE — deleting a user invalidates all their
--     tokens.
--   - audit_log user_id + token_id are ON DELETE SET NULL so audit
--     history survives user/token deletion.

-- ─── mcp_tokens ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 hex of the raw token (never store raw).
  token_hash TEXT NOT NULL UNIQUE,
  -- First 8 chars of the raw token — safe to display, helps users
  -- distinguish "which of my 3 tokens is this" without leaking the secret.
  token_prefix TEXT NOT NULL,
  -- Human label ("Hermes at hermes-agent.org"). Required so users
  -- remember what a token is for.
  name TEXT NOT NULL,
  -- Updated on every successful auth. Lets users spot dead tokens.
  last_used_at TIMESTAMPTZ,
  -- Soft delete. NULL = active. Set to now() to revoke.
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast "list this user's active tokens" for the settings UI.
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user_active
  ON mcp_tokens(user_id) WHERE revoked_at IS NULL;

-- Fast lookup on every auth. Partial index skips revoked rows so a
-- deprecated token can never match, even by collision.
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_hash_active
  ON mcp_tokens(token_hash) WHERE revoked_at IS NULL;

-- ─── mcp_audit_log ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mcp_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Attribution — WHO called this tool. Both nullable so audit history
  -- survives user/token deletion.
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  token_id UUID REFERENCES mcp_tokens(id) ON DELETE SET NULL,
  -- The tool that was called (e.g. 'get_deal', 'update_deal').
  tool_name TEXT NOT NULL,
  -- Input args, JSONB. Redact PII beyond names/emails at write time.
  input JSONB,
  -- Outcome. 'success' | 'error' | 'unauthorized' | 'rate_limited'
  output_status TEXT,
  -- Rough measure of response size (bytes of the JSON output). Nulls OK.
  output_size_bytes INT,
  duration_ms INT,
  -- Only set when status != 'success'.
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "What did user X do recently?" — the most common audit query.
CREATE INDEX IF NOT EXISTS idx_mcp_audit_user_recent
  ON mcp_audit_log(user_id, created_at DESC);

-- "Which tools are seeing the most traffic?" — for rate-limit tuning.
CREATE INDEX IF NOT EXISTS idx_mcp_audit_tool_recent
  ON mcp_audit_log(tool_name, created_at DESC);
-- Migration 016: Telegram user linking.
--
-- Two tables:
--   1. telegram_user_links      — one row per (salesbrain_user, telegram_user)
--                                 binding. When a linked user DMs the bot,
--                                 messages route through Claude with that
--                                 user's MCP visibility scope.
--   2. telegram_link_tokens     — short-lived one-time codes generated at
--                                 /settings/telegram. User sends /start
--                                 <code> to the bot to complete the bind.
--
-- Design decisions:
--   - One SalesBrain user can link at most one Telegram account at a time
--     (UNIQUE user_id in telegram_user_links). Re-linking replaces the
--     existing binding.
--   - The reverse — one Telegram user linked to one SalesBrain user — is
--     also enforced by UNIQUE telegram_user_id. Different Telegram user
--     for same SalesBrain user requires revoking the old first.
--   - Link tokens are 10 chars (LINK-<6 base32> — friendly to type on a
--     phone), single-use, expire in 15 minutes. Hashed just like MCP
--     tokens (SHA-256 hex). token_prefix stored plaintext for UI display.
--   - revoked_at (nullable) on telegram_user_links enables soft delete so
--     historical messages can still resolve the link_id if we ever store
--     conversation history.

-- ─── telegram_user_links ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS telegram_user_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Telegram's user id is a bigint (they hand out large numeric ids).
  telegram_user_id BIGINT NOT NULL,
  -- Chat id for DMs. For private chats with users, this equals
  -- telegram_user_id. Storing it separately in case Telegram ever
  -- changes that assumption.
  telegram_chat_id BIGINT NOT NULL,
  -- Display metadata captured at link time — used to render "linked as
  -- @amir" in the settings UI without requiring another Telegram API call.
  telegram_username TEXT,
  telegram_first_name TEXT,
  telegram_last_name TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

-- One active binding per SalesBrain user and per Telegram user.
CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_links_user
  ON telegram_user_links(user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_links_tg
  ON telegram_user_links(telegram_user_id) WHERE revoked_at IS NULL;

-- ─── telegram_link_tokens ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 hex of the raw token. Raw token is shown ONCE at generation.
  token_hash TEXT NOT NULL UNIQUE,
  -- Full raw token starts with `LINK-`; prefix for display / debugging.
  token_prefix TEXT NOT NULL,
  -- 15-min TTL by default. Expiry lives on the row so we can extend
  -- per-token later if we want.
  expires_at TIMESTAMPTZ NOT NULL,
  -- Set on successful use; null while pending.
  used_at TIMESTAMPTZ,
  used_by_telegram_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_active
  ON telegram_link_tokens(user_id) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_hash
  ON telegram_link_tokens(token_hash) WHERE used_at IS NULL;
-- Migration 017: soft delete for deals.
--
-- Design decisions:
--   - deleted_at (nullable TIMESTAMPTZ) is the marker. NULL = active.
--     Any timestamp = soft-deleted at that instant.
--   - deleted_by (nullable UUID → users) records who did the deletion.
--     ON DELETE SET NULL so removing a user doesn't lose the audit trail.
--   - Partial index on active rows: WHERE deleted_at IS NULL. Every
--     hot-path query filters by this so the index keeps them fast and
--     small (won't include tombstoned rows).
--
-- Permission model (enforced at API + MCP dispatch layer, not in SQL):
--   - Delete: deal creator (user_id), assigned lead (lead_id), or admin
--   - Restore: admin only
--
-- Cascading behavior:
--   - Related rows (conversations, gate_events, followups, board_decisions,
--     client_onboardings, lessons_learned, pricing_quotes, file_attachments)
--     are NOT cascaded. Restoring a deal preserves its full history.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Hot-path index: every non-admin deal query filters `WHERE deleted_at IS NULL`.
-- Partial index keeps it small and skips deleted rows entirely.
CREATE INDEX IF NOT EXISTS idx_deals_active
  ON deals(updated_at DESC)
  WHERE deleted_at IS NULL;

-- Admin "trash view" index — sorted by deletion recency for restore workflows.
CREATE INDEX IF NOT EXISTS idx_deals_deleted
  ON deals(deleted_at DESC)
  WHERE deleted_at IS NOT NULL;
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

-- Migration 030: Grant Stage 2 — post-award utilization tracking.
--
-- Splits G9 into pre/post-signature via contract_signed_at, promotes
-- won/cancelled from inferred to explicit deal statuses, and adds two
-- child tables (grant_resources, grant_reports) plus a lead-handover
-- audit table so ChipChip can actually see whether awarded resources
-- arrived and were used, and get Telegram reminders on report deadlines.
-- Full rationale: db/migrations/030_grant_stage2.sql.

ALTER TABLE deals
    ADD COLUMN IF NOT EXISTS contract_signed_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS won_at              TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS cancelled_reason    TEXT NULL;

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_status_check;
ALTER TABLE deals ADD CONSTRAINT deals_status_check
    CHECK (status IN ('active','won','lost','cancelled'));

CREATE TABLE IF NOT EXISTS deal_lead_history (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id      UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    prev_lead_id UUID REFERENCES users(id),
    new_lead_id  UUID REFERENCES users(id),
    reason       TEXT,
    changed_by   UUID REFERENCES users(id),
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_lead_history_deal ON deal_lead_history(deal_id);

CREATE TABLE IF NOT EXISTS grant_resources (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id           UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    resource_type     TEXT NOT NULL CHECK (resource_type IN
                        ('cash','reimbursement','credits','in_kind','direct_vendor','financing','other')),
    activation_method TEXT,
    committed_amount  NUMERIC(15,2),
    received_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
    utilized_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
    units_label       TEXT,
    currency          TEXT NOT NULL DEFAULT 'USD',
    expected_at       DATE,
    expires_at        DATE,
    status            TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN
                        ('not_started','requested','partly_available','fully_available',
                         'fully_utilized','reconciled','returned','cancelled','expired')),
    proof_url         TEXT,
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grant_resources_deal     ON grant_resources(deal_id);
CREATE INDEX IF NOT EXISTS idx_grant_resources_expected ON grant_resources(expected_at)
    WHERE expected_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grant_resources_expires  ON grant_resources(expires_at)
    WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS grant_reports (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id       UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    report_type   TEXT NOT NULL CHECK (report_type IN
                    ('financial','narrative','impact','logframe','audit','other')),
    title         TEXT NOT NULL,
    due_at        DATE NOT NULL,
    status        TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN
                    ('not_started','drafting','internal_review','submitted','accepted','overdue')),
    submitted_at  TIMESTAMPTZ,
    accepted_at   TIMESTAMPTZ,
    evidence_url  TEXT,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grant_reports_deal ON grant_reports(deal_id);
CREATE INDEX IF NOT EXISTS idx_grant_reports_due ON grant_reports(due_at)
    WHERE status NOT IN ('accepted','submitted');

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
        CREATE FUNCTION set_updated_at() RETURNS trigger AS $body$
        BEGIN NEW.updated_at = now(); RETURN NEW; END;
        $body$ LANGUAGE plpgsql;
    END IF;
END $$;

DROP TRIGGER IF EXISTS trg_grant_resources_updated ON grant_resources;
CREATE TRIGGER trg_grant_resources_updated
    BEFORE UPDATE ON grant_resources
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_grant_reports_updated ON grant_reports;
CREATE TRIGGER trg_grant_reports_updated
    BEFORE UPDATE ON grant_reports
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Migration 031: AI credits — a third deal_type alongside sales + grant.
-- Full rationale: db/migrations/031_ai_credits.sql. Existing deals CHECK
-- above already includes 'ai_credit' from the widened form; below adds
-- the two new columns (applicant_entity + grant_resources.provider).

ALTER TABLE deals ADD COLUMN IF NOT EXISTS applicant_entity TEXT
    CHECK (applicant_entity IS NULL
           OR applicant_entity IN ('chipchip','zeami','both'));

ALTER TABLE grant_resources ADD COLUMN IF NOT EXISTS provider TEXT;
CREATE INDEX IF NOT EXISTS idx_grant_resources_provider
    ON grant_resources(provider) WHERE provider IS NOT NULL;

-- ─── Service MCP: outreach-as-a-service for a sibling app (migration 032) ───
-- One bearer token per consuming app + a map from that app's employee ids to
-- provisioned SalesBrain users. See db/migrations/032_service_mcp.sql.

CREATE TABLE IF NOT EXISTS service_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_key TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_tokens_hash_active
  ON service_tokens(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_tokens_app
  ON service_tokens(app_key) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS external_employees (
  app_key TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  salesbrain_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  PRIMARY KEY (app_key, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_external_employees_user
  ON external_employees(salesbrain_user_id);
