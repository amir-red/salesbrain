-- Add a primary contact email to client_onboardings.
-- Seeded from the deal's contact_email at onboarding creation. The client
-- can later confirm or update it via the public Stage-2 form so we have a
-- single source of truth for the project's primary email going forward.
-- (The deal's own contact_email stays as the sales-side contact.)

ALTER TABLE client_onboardings
  ADD COLUMN IF NOT EXISTS primary_contact_email TEXT;
