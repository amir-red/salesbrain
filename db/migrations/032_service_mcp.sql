-- Migration 032: "Sales Outreach as a Service" — a dedicated MCP surface that
-- lets a sibling internal app drive the full outreach pipeline on behalf of
-- ITS OWN users. Two tables (mirrors the mcp_tokens design in migration 015):
--
--   1. service_tokens    — one bearer secret per consuming app (SHA-256
--                          hashed, never stored raw). This authenticates the
--                          APP, not an end user.
--   2. external_employees — maps an (app_key, employee_id) the other app sends
--                          at registration to a real SalesBrain users row. The
--                          kernel is multi-tenant on owner_user_id, so every
--                          outreach call runs as that mapped user (its Actor).
--
-- Per-call audit reuses mcp_audit_log (the acting employee_id is written into
-- its `input` JSON), so no new audit table is needed.
--
-- Design mirrors 015: token_hash UNIQUE + partial index on active rows;
-- revoked_at soft-delete; ON DELETE CASCADE on the user FK so removing a
-- provisioned user tears down its mapping.

-- ─── service_tokens ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS service_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which sibling app holds this token (e.g. 'chipchip-outbound'). Also the
  -- namespace for that app's employee ids in external_employees.
  app_key TEXT NOT NULL,
  -- SHA-256 hex of the raw token (raw is 'svc_' + base64url(32 bytes)).
  token_hash TEXT NOT NULL UNIQUE,
  -- First 12 chars of the raw token, safe to display ("svc_a1b2c3d4").
  token_prefix TEXT NOT NULL,
  -- Human label ("ChipChip outbound app, prod").
  name TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_tokens_hash_active
  ON service_tokens(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_tokens_app
  ON service_tokens(app_key) WHERE revoked_at IS NULL;

-- ─── external_employees ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS external_employees (
  -- Namespace: which app the employee_id belongs to.
  app_key TEXT NOT NULL,
  -- The stable id the sibling app sends at register_user and on every request
  -- (X-On-Behalf-Of). Opaque to us — could be a uuid, an email, a payroll id.
  employee_id TEXT NOT NULL,
  -- The provisioned SalesBrain user this employee acts as. Un-loginable by
  -- password (sentinel hash), role 'user'. All owner-scoped rows (icp_profiles,
  -- prospects, linkedin_accounts, outreach_approvals) hang off this id.
  salesbrain_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  PRIMARY KEY (app_key, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_external_employees_user
  ON external_employees(salesbrain_user_id);
