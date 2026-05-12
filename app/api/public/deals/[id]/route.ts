import { NextRequest } from 'next/server';
import pool from '@/lib/db';
import { requireApiKey, jsonWithCors, corsOptions } from '@/lib/public-api';
import { SALES_GATES, GRANT_GATES } from '@/lib/gates';

/**
 * GET /api/public/deals/[id]
 *
 * Server-to-server endpoint that returns the full company / pipeline context
 * for a single deal. Used by external systems (e.g. zeami.io) to extract the
 * client's company info and pipeline state for downstream rendering.
 *
 * Auth: shared API key (`ONBOARDING_API_KEY` env var, `X-API-Key` header).
 * Resource: one deal per request, addressed by UUID. There is no list
 * endpoint here by design — keep external blast radius narrow.
 *
 * Response groups (all values may be null if not captured):
 *   - `deal`:     pipeline identity + state (id, name, gate, etc.)
 *   - `company`:  client-side metadata (name, website, size, industry, etc.)
 *   - `contact`:  primary deal contact (name, email, title, phone)
 *   - `insights`: agent-captured `deals.fields` raw, plus a curated subset
 *   - `onboarding`: pointer + state if a client_onboardings row exists
 *
 * Intentionally NOT returned:
 *   - score, risk, verdict (sales-internal scoring)
 *   - flags, missing, raw notes (sales-internal annotations)
 *   - lead_id / user_id (internal CRM identity)
 */

export function OPTIONS(req: NextRequest) {
  return corsOptions(req);
}

interface DealRow {
  id: string;
  name: string;
  company: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  gate: number;
  gate_entered_at: string;
  deal_type: 'sales' | 'grant';
  value: string | null;
  currency: string | null;
  fields: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface AccountRow {
  domain: string | null;
  website: string | null;
  industry: string | null;
  company_size: string | null;
  hq_location: string | null;
}

interface OnboardingRow {
  id: string;
  stage: number;
  status: string;
  deployment_plan: 'on_premise' | 'saas_cloud' | null;
  primary_contact_email: string | null;
  // PM (joined from users table)
  pm_name: string | null;
  pm_email: string | null;
  // Stage 1: company profile (the onboarding's own copy — may diverge from
  // the sales-side `deals.company` if the client edited via the public form)
  company_name: string;
  website: string | null;
  company_size: string | null;
  description: string | null;
  // Stage 2: contacts
  executive_name: string | null;
  executive_email: string | null;
  executive_role: string | null;
  project_manager_name: string | null;
  project_manager_email: string | null;
  it_admin_name: string | null;
  it_admin_email: string | null;
  // Stage 3: access & comms (NEVER exposes app_credentials — sensitive)
  server_setup_done: boolean;
  app_setup_done: boolean;
  download_url: string | null;
  email_sent_at: string | null;
  // Stage 4: briefing
  briefing_meeting_at: string | null;
  briefing_notes: string | null;
  // Stage 5: employee setup
  employee_count: number | null;
  employee_setup_notes: string | null;
  // Stage 6: deployment
  deployment_started_at: string | null;
  // Stage 7: audit
  audit_started_at: string | null;
  audit_notes: string | null;
  // Stage 8: P&L
  pnl_ready_at: string | null;
  pnl_report_url: string | null;
  // Per-stage completion timestamps
  stage1_completed_at: string | null;
  stage2_completed_at: string | null;
  stage3_completed_at: string | null;
  stage4_completed_at: string | null;
  stage5_completed_at: string | null;
  stage6_completed_at: string | null;
  stage7_completed_at: string | null;
  stage8_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denial = requireApiKey(req);
  if (denial) return denial;

  // UUID guard so we don't run a query on garbage
  const id = params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return jsonWithCors(req, { error: 'Invalid deal id' }, 400);
  }

  try {
    const { rows } = await pool.query<DealRow>(
      `SELECT id, name, company, contact_name, contact_email, contact_phone,
              gate, gate_entered_at, deal_type, value, currency, fields,
              created_at, updated_at
       FROM deals WHERE id = $1 LIMIT 1`,
      [id]
    );
    const deal = rows[0];
    if (!deal) return jsonWithCors(req, { error: 'Deal not found' }, 404);

    // Pull the linked account row by company name (the CRM keys accounts by
    // name, not by FK from deal). Best-effort — null fields are fine.
    const { rows: acctRows } = await pool.query<AccountRow>(
      `SELECT domain, website, industry, company_size, hq_location
       FROM accounts WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [deal.company]
    );
    const acct = acctRows[0] ?? null;

    // Pull the onboarding row if one exists (sales deals at G9 will have one).
    // Joined with users for the PM's name/email (the internal user_id stays
    // server-side; only the human-readable identity is exposed).
    // `app_credentials` is intentionally OMITTED — sensitive even if it was
    // cleared after the Stage-3 email send.
    const { rows: onbRows } = await pool.query<OnboardingRow>(
      `SELECT o.id, o.stage, o.status, o.deployment_plan, o.primary_contact_email,
              u.name AS pm_name, u.email AS pm_email,
              o.company_name, o.website, o.company_size, o.description,
              o.executive_name, o.executive_email, o.executive_role,
              o.project_manager_name, o.project_manager_email,
              o.it_admin_name, o.it_admin_email,
              o.server_setup_done, o.app_setup_done, o.download_url, o.email_sent_at,
              o.briefing_meeting_at, o.briefing_notes,
              o.employee_count, o.employee_setup_notes,
              o.deployment_started_at,
              o.audit_started_at, o.audit_notes,
              o.pnl_ready_at, o.pnl_report_url,
              o.stage1_completed_at, o.stage2_completed_at, o.stage3_completed_at,
              o.stage4_completed_at, o.stage5_completed_at, o.stage6_completed_at,
              o.stage7_completed_at, o.stage8_completed_at,
              o.created_at, o.updated_at
       FROM client_onboardings o
       LEFT JOIN users u ON u.id = o.pm_user_id
       WHERE o.deal_id = $1 LIMIT 1`,
      [id]
    );
    const onb = onbRows[0] ?? null;

    // Captured insights — curate a subset that's safe to surface externally,
    // plus expose the full `fields` raw under `insights.raw` for callers that
    // need anything else (it's just sales-conversation captured data, no
    // secrets). Filter out fields that look internal/sensitive.
    const fields = (deal.fields ?? {}) as Record<string, unknown>;
    const insights = {
      industry:        getStr(fields.industry) ?? acct?.industry ?? null,
      company_size:    getStr(fields.company_size) ?? acct?.company_size ?? null,
      hq_location:     acct?.hq_location ?? getStr(fields.hq_location) ?? null,
      business_model:  getStr(fields.business_model),
      pain_point:      getStr(fields.pain_point),
      growth_rate:     getStr(fields.growth_rate),
      annual_revenue:  getStr(fields.annual_revenue),
      solution_fit:    getStr(fields.solution_fit),
      sales_cycle:     getStr(fields.sales_cycle),
      payment_terms:   getStr(fields.payment_terms),
      desktop_heavy_roles: getStr(fields.desktop_heavy_roles),
      pilot_or_full:   getStr(fields.pilot_or_full),
      deployment_plan: (onb?.deployment_plan ?? getStr(fields.deployment_plan)) as 'on_premise' | 'saas_cloud' | null,
      // Full agent-captured payload for callers that want the raw set
      raw: fields,
    };

    const gateDef = (deal.deal_type === 'grant' ? GRANT_GATES : SALES_GATES)
      .find((g) => g.number === deal.gate);

    return jsonWithCors(req, {
      deal: {
        id: deal.id,
        name: deal.name,
        deal_type: deal.deal_type,
        gate: deal.gate,
        gate_name: gateDef?.name ?? null,
        gate_entered_at: deal.gate_entered_at,
        value: deal.value ? Number(deal.value) : null,
        currency: deal.currency,
        created_at: deal.created_at,
        updated_at: deal.updated_at,
      },
      company: {
        name: deal.company,
        website: acct?.website ?? buildWebsiteFromEmail(deal.contact_email),
        domain: acct?.domain ?? null,
        size: insights.company_size,
        industry: insights.industry,
        location: insights.hq_location,
      },
      contact: {
        name: deal.contact_name,
        email: deal.contact_email,
        phone: deal.contact_phone,
        title: getStr(fields.contact_title),
      },
      insights,
      onboarding: onb ? {
        // Top-level identity + progress (unchanged from prior schema —
        // existing callers keep working).
        id: onb.id,
        stage: onb.stage,
        status: onb.status,
        deployment_plan: onb.deployment_plan,
        primary_contact_email: onb.primary_contact_email,
        created_at: onb.created_at,
        updated_at: onb.updated_at,

        // Assigned internal project manager — human-readable only.
        pm: (onb.pm_name || onb.pm_email) ? {
          name: onb.pm_name,
          email: onb.pm_email,
        } : null,

        // The onboarding row's *own* copy of the company profile. Editable
        // by the client via the public form, so it may diverge from the
        // sales-side `company` block above.
        company_profile: {
          company_name: onb.company_name,
          website: onb.website,
          company_size: onb.company_size,
          description: onb.description,
          primary_contact_email: onb.primary_contact_email,
        },

        // Stage 2 — the 3 role contacts the client submitted (or that the
        // PM filled inline).
        contacts: {
          executive: contactBlock(onb.executive_name, onb.executive_email, onb.executive_role),
          project_manager: contactBlock(onb.project_manager_name, onb.project_manager_email, null),
          it_admin: contactBlock(onb.it_admin_name, onb.it_admin_email, null),
        },

        // Stage 3 — access & comms. `app_credentials` is intentionally
        // not exposed (sensitive). `email_sent_at` tells you when the
        // IT-admin email went out.
        access: {
          server_setup_done: onb.server_setup_done,
          app_setup_done: onb.app_setup_done,
          download_url: onb.download_url,
          email_sent_at: onb.email_sent_at,
        },

        // Stage 4 — briefing meeting
        briefing: {
          meeting_at: onb.briefing_meeting_at,
          notes: onb.briefing_notes,
        },

        // Stage 5 — employee setup
        employees: {
          count: onb.employee_count,
          setup_notes: onb.employee_setup_notes,
        },

        // Stage 6 — deployment
        deployment: {
          started_at: onb.deployment_started_at,
        },

        // Stage 7 — automated audit
        audit: {
          started_at: onb.audit_started_at,
          notes: onb.audit_notes,
        },

        // Stage 8 — P&L
        pnl: {
          ready_at: onb.pnl_ready_at,
          report_url: onb.pnl_report_url,
        },

        // Per-stage completion timestamps (unchanged — drives the timeline
        // checkmarks in the UI).
        stage_completions: {
          stage1: onb.stage1_completed_at,
          stage2: onb.stage2_completed_at,
          stage3: onb.stage3_completed_at,
          stage4: onb.stage4_completed_at,
          stage5: onb.stage5_completed_at,
          stage6: onb.stage6_completed_at,
          stage7: onb.stage7_completed_at,
          stage8: onb.stage8_completed_at,
        },
      } : null,
    });
  } catch (err) {
    console.error('[GET /api/public/deals/:id]', err);
    return jsonWithCors(req, { error: 'Internal error' }, 500);
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function getStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  return String(v);
}

/** Helper for the 3 contact blocks in the onboarding response. Returns null
 *  when all three values are empty so the caller can easily detect "this
 *  contact wasn't submitted yet". */
function contactBlock(
  name: string | null,
  email: string | null,
  role: string | null,
): { name: string | null; email: string | null; role: string | null } | null {
  if (!name && !email && !role) return null;
  return { name, email, role };
}

const PUBLIC_MAIL_DOMAINS = /^(gmail|yahoo|hotmail|outlook|icloud|proton|aol)\./i;
function buildWebsiteFromEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain || PUBLIC_MAIL_DOMAINS.test(domain)) return null;
  return `https://${domain}`;
}
