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
