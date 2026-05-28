-- Add an optional "Assistant" co-PM to client onboardings.
--
-- An assistant has the same edit rights as the PM (advance stages, fill
-- fields, send emails, generate form links). The PM stays the canonical
-- owner; the assistant is a delegated co-driver so a single onboarding
-- doesn't bottleneck on one person being available.
--
-- Permissions for assigning the assistant: PM or admin (so the PM can
-- pick their helper without bothering an admin every time). Permissions
-- for the assistant itself once assigned: same mutation rights as PM.

ALTER TABLE client_onboardings
  ADD COLUMN IF NOT EXISTS assistant_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_onboardings_assistant
  ON client_onboardings(assistant_user_id);
