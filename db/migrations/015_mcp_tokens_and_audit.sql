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
