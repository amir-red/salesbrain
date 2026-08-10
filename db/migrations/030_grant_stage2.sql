-- Migration 030: Grant Stage 2 — post-award utilization tracking.
--
-- Identical to salesbrain-core/migrations/030_grant_stage2.sql. Both files
-- exist because either deploy pipeline (app or ring/core) may apply the
-- migration and the runners glob different directories. See that file for
-- the full rationale; the copy below is byte-identical to keep audits
-- easy and to avoid one runner seeing a different DDL than the other.

-- ─── deal-level additions ─────────────────────────────────────────────

ALTER TABLE deals
    ADD COLUMN IF NOT EXISTS contract_signed_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS won_at              TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS cancelled_reason    TEXT NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'deals_status_check'
    ) THEN
        ALTER TABLE deals DROP CONSTRAINT deals_status_check;
    END IF;
END $$;
ALTER TABLE deals ADD CONSTRAINT deals_status_check
    CHECK (status IN ('active','won','lost','cancelled'));

-- ─── deal_lead_history ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deal_lead_history (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id      UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    prev_lead_id UUID REFERENCES users(id),
    new_lead_id  UUID REFERENCES users(id),
    reason       TEXT,
    changed_by   UUID REFERENCES users(id),
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_lead_history_deal ON deal_lead_history(deal_id);

-- ─── grant_resources ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS grant_resources (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id           UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    resource_type     TEXT NOT NULL CHECK (resource_type IN
                        ('cash','reimbursement','credits','in_kind','direct_vendor','financing','other')),
    activation_method TEXT,
    committed_amount  NUMERIC(15,2),
    received_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
    utilized_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
    units_label       TEXT,
    currency          TEXT NOT NULL DEFAULT 'USD',
    expected_at       DATE,
    expires_at        DATE,
    status            TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN
                        ('not_started','requested','partly_available','fully_available',
                         'fully_utilized','reconciled','returned','cancelled','expired')),
    proof_url         TEXT,
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grant_resources_deal     ON grant_resources(deal_id);
CREATE INDEX IF NOT EXISTS idx_grant_resources_expected ON grant_resources(expected_at)
    WHERE expected_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grant_resources_expires  ON grant_resources(expires_at)
    WHERE expires_at IS NOT NULL;

-- ─── grant_reports ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS grant_reports (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id       UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    report_type   TEXT NOT NULL CHECK (report_type IN
                    ('financial','narrative','impact','logframe','audit','other')),
    title         TEXT NOT NULL,
    due_at        DATE NOT NULL,
    status        TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN
                    ('not_started','drafting','internal_review','submitted','accepted','overdue')),
    submitted_at  TIMESTAMPTZ,
    accepted_at   TIMESTAMPTZ,
    evidence_url  TEXT,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grant_reports_deal ON grant_reports(deal_id);
CREATE INDEX IF NOT EXISTS idx_grant_reports_due ON grant_reports(due_at)
    WHERE status NOT IN ('accepted','submitted');

-- ─── touch-timestamp triggers ─────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
        CREATE FUNCTION set_updated_at() RETURNS trigger AS $body$
        BEGIN NEW.updated_at = now(); RETURN NEW; END;
        $body$ LANGUAGE plpgsql;
    END IF;
END $$;

DROP TRIGGER IF EXISTS trg_grant_resources_updated ON grant_resources;
CREATE TRIGGER trg_grant_resources_updated
    BEFORE UPDATE ON grant_resources
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_grant_reports_updated ON grant_reports;
CREATE TRIGGER trg_grant_reports_updated
    BEFORE UPDATE ON grant_reports
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
