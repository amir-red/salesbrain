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
