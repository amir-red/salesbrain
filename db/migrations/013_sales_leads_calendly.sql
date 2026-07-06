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
