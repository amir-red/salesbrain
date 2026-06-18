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
