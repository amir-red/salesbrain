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
