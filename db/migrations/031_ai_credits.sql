-- Migration 031: AI credits — a third deal_type alongside sales + grant.
--
-- Identical to salesbrain-core/migrations/031_ai_credits.sql. Both files
-- exist because either deploy pipeline (app or ring/core) may apply the
-- migration and the runners glob different directories. See that file
-- for the full rationale; the copy below is byte-identical.

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_deal_type_check;
ALTER TABLE deals ADD CONSTRAINT deals_deal_type_check
    CHECK (deal_type IN ('sales','grant','ai_credit'));

ALTER TABLE lessons_learned DROP CONSTRAINT IF EXISTS lessons_learned_deal_type_check;
ALTER TABLE lessons_learned ADD CONSTRAINT lessons_learned_deal_type_check
    CHECK (deal_type IN ('sales','grant','ai_credit'));

ALTER TABLE deals ADD COLUMN IF NOT EXISTS applicant_entity TEXT
    CHECK (applicant_entity IS NULL
           OR applicant_entity IN ('chipchip','zeami','both'));

ALTER TABLE grant_resources ADD COLUMN IF NOT EXISTS provider TEXT;
CREATE INDEX IF NOT EXISTS idx_grant_resources_provider
    ON grant_resources(provider) WHERE provider IS NOT NULL;
