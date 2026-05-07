-- Deployment plan carried over from the sales deal at G9 handover.
-- Two valid values: 'on_premise' (secure local, air-gapped) or 'saas_cloud'
-- (fully managed, auto-scaling). Captured at G7 Negotiation in the deal's
-- JSONB fields, then copied into the onboarding row when it's created.

ALTER TABLE client_onboardings
  ADD COLUMN IF NOT EXISTS deployment_plan TEXT
  CHECK (deployment_plan IN ('on_premise', 'saas_cloud'));
