-- Sales leads: lightweight intake from external "Request Demo" forms
-- (initially zeami.io). Captures the form submission as-is; manual triage
-- from the /sales-leads page converts a lead into a G1 sales deal.
--
-- One submission = one row. No de-duplication on email/company (a single
-- person legitimately requests demos from multiple browsers / for multiple
-- companies); duplicates are surfaced in the UI but not blocked.

CREATE TABLE IF NOT EXISTS sales_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  company TEXT NOT NULL,
  email TEXT NOT NULL,
  description TEXT,                          -- optional free-text from the form

  -- Where did this lead come from? Free text so we can branch in the future
  -- (zeami.io demo form / chipchip.social waitlist / cold reply / etc.)
  source TEXT NOT NULL DEFAULT 'zeami.io:request-demo',

  -- Triage state. 'new' is the inbox; 'converted' means a deal was created;
  -- 'archived' is the "not worth pursuing" graveyard.
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'converted', 'archived')),

  -- Set when status flips to 'converted' — link to the deal we created.
  converted_deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  converted_by UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Raw payload (headers / extra fields) for debugging if the form ever
  -- evolves and we want to inspect what the source actually sent.
  raw_payload JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_leads_status_created
  ON sales_leads(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_leads_email
  ON sales_leads(lower(email));
