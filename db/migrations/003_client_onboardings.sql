-- Client Onboarding tables
-- Tracks the post-G9 internal workflow that takes a won sales deal through
-- 8 stages and into a live Zeami deployment.

CREATE TABLE IF NOT EXISTS client_onboardings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
  pm_user_id UUID REFERENCES users(id),
  stage SMALLINT NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 8),
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'paused')),

  -- Stage 1: Company Info (prefilled from deal)
  company_name TEXT NOT NULL,
  website TEXT,
  company_size TEXT,
  description TEXT,

  -- Stage 2: Contact Person & Roles
  executive_name TEXT,
  executive_email TEXT,
  executive_role TEXT,
  project_manager_name TEXT,
  project_manager_email TEXT,
  it_admin_name TEXT,
  it_admin_email TEXT,

  -- Stage 3: Access & Communication
  server_setup_done BOOLEAN NOT NULL DEFAULT false,
  app_setup_done    BOOLEAN NOT NULL DEFAULT false,
  download_url TEXT,
  app_credentials TEXT,           -- cleared (set NULL) after email_sent_at fires
  email_sent_at TIMESTAMPTZ,

  -- Stage 4: Briefing
  briefing_meeting_at TIMESTAMPTZ,
  briefing_notes TEXT,

  -- Stage 5: Employee setup
  employee_count INT,
  employee_setup_notes TEXT,

  -- Stage 6: Deploy
  deployment_started_at TIMESTAMPTZ,

  -- Stage 7: Audit
  audit_started_at TIMESTAMPTZ,
  audit_notes TEXT,

  -- Stage 8: P&L
  pnl_ready_at TIMESTAMPTZ,
  pnl_report_url TEXT,

  -- Per-stage completion timestamps
  stage1_completed_at TIMESTAMPTZ,
  stage2_completed_at TIMESTAMPTZ,
  stage3_completed_at TIMESTAMPTZ,
  stage4_completed_at TIMESTAMPTZ,
  stage5_completed_at TIMESTAMPTZ,
  stage6_completed_at TIMESTAMPTZ,
  stage7_completed_at TIMESTAMPTZ,
  stage8_completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboardings_pm ON client_onboardings(pm_user_id);
CREATE INDEX IF NOT EXISTS idx_onboardings_stage ON client_onboardings(stage);

DROP TRIGGER IF EXISTS onboardings_updated_at ON client_onboardings;
CREATE TRIGGER onboardings_updated_at
  BEFORE UPDATE ON client_onboardings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Token table for the Stage-2 external client form.
-- Same shape as password_resets: hashed, single-use, time-limited.
CREATE TABLE IF NOT EXISTS onboarding_form_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id UUID NOT NULL REFERENCES client_onboardings(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_links_token_hash ON onboarding_form_links(token_hash);
CREATE INDEX IF NOT EXISTS idx_onboarding_links_onboarding ON onboarding_form_links(onboarding_id);
