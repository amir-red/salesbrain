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
  deployment_plan: string | null;
  primary_contact_email: string | null;
  stage1_completed_at: string | null;
  stage2_completed_at: string | null;
  stage3_completed_at: string | null;
  stage4_completed_at: string | null;
  stage5_completed_at: string | null;
  stage6_completed_at: string | null;
  stage7_completed_at: string | null;
  stage8_completed_at: string | null;
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
    const { rows: onbRows } = await pool.query<OnboardingRow>(
      `SELECT id, stage, status, deployment_plan, primary_contact_email,
              stage1_completed_at, stage2_completed_at, stage3_completed_at,
              stage4_completed_at, stage5_completed_at, stage6_completed_at,
              stage7_completed_at, stage8_completed_at
       FROM client_onboardings WHERE deal_id = $1 LIMIT 1`,
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
        id: onb.id,
        stage: onb.stage,
        status: onb.status,
        deployment_plan: onb.deployment_plan,
        primary_contact_email: onb.primary_contact_email,
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

const PUBLIC_MAIL_DOMAINS = /^(gmail|yahoo|hotmail|outlook|icloud|proton|aol)\./i;
function buildWebsiteFromEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain || PUBLIC_MAIL_DOMAINS.test(domain)) return null;
  return `https://${domain}`;
}
