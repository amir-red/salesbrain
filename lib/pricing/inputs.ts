/**
 * Pricing tool input schema, defaults, and deal-prefill helpers.
 *
 * Pure module — no DB or IO. Safe to import from client components if needed.
 */

import { z } from 'zod';

// ─── Input names + defaults ────────────────────────────────────────────────
// These match the named ranges we ask you to add in Excel (see the plan doc).
// If a name isn't defined in the workbook yet, the engine falls back to the
// hardcoded cell coordinate in CELL_FALLBACKS below so the system works even
// before the Excel hygiene pass is done.

export const PricingInputSchema = z.object({
  customer_name: z.string().min(1).max(255),
  country: z.string().min(1).max(120),
  seats: z.number().int().min(1).max(100000),
  customer_annual_revenue: z.number().nonnegative(),
  customer_annual_labor_cost: z.number().nonnegative(),
  ebitda_pct: z.number().min(0).max(1),
  pilot_discount: z.number().min(0).max(1).default(0.1),

  // Pilot economics (advanced)
  consultant_base_rate: z.number().nonnegative().default(120),
  consultant_count: z.number().int().nonnegative().default(2),
  consultant_hours: z.number().nonnegative().default(30),
  travel_per_consultant: z.number().nonnegative().default(500),
  hotel_nightly_rate: z.number().nonnegative().default(100),
  llm_cost_per_person_day: z.number().nonnegative().default(2.5),
  pilot_people_observed: z.number().int().nonnegative().default(15),
  pilot_observation_days: z.number().int().nonnegative().default(14),

  // Implementation (advanced)
  impl_integration_hrs_per_emp: z.number().nonnegative().default(1.28),
  impl_workflow_hrs_per_emp: z.number().nonnegative().default(4.62),
  impl_training_hrs_per_emp: z.number().nonnegative().default(0.96),
  impl_calibration_hrs_per_emp: z.number().nonnegative().default(3.0),
  impl_pm_hours: z.number().nonnegative().default(20),
  impl_travel_budget: z.number().nonnegative().default(1600),

  // Recurring (advanced)
  seat_base_price: z.number().nonnegative().default(25),
  improvement_subscription: z.number().nonnegative().default(0),

  // Agent revenue estimation (advanced)
  automatable_work_pct: z.number().min(0).max(1).default(0.18),
  tier1_pct: z.number().min(0).max(1).default(0.3),
  tier2_pct: z.number().min(0).max(1).default(0.4),
  tier3_pct: z.number().min(0).max(1).default(0.2),
  tier4_pct: z.number().min(0).max(1).default(0.1),
});

export type PricingInputs = z.infer<typeof PricingInputSchema>;

/** The named ranges the engine reads back as outputs after evaluation. */
export const OUTPUT_NAMES = [
  'pilot_price',
  'implementation_price',
  'implementation_minus_pilot_credit',
  'effective_seat_price',
  'monthly_platform',
  'monthly_agents',
  'monthly_improvement',
  'monthly_total',
  'annual_recurring',
  'year_1_total',
  'est_profit_increase',
  'roi_after_impl',
  'payback_months',
  'weighted_capture_rate',
  'monthly_agent_rev_per_emp',
] as const;

export type PricingOutputs = Record<(typeof OUTPUT_NAMES)[number], number | null>;

export const PNL_OUTPUT_NAMES = [
  'year_1_revenue',
  'year_1_gross_profit',
] as const;

export type PricingPnl = Record<(typeof PNL_OUTPUT_NAMES)[number], number | null>;

// ─── Fallback cell-coordinate map ──────────────────────────────────────────
// Until the Excel has named ranges defined, the engine uses these. Cells are
// in `'<sheet>'!<cell>` format — preserves the literal sheet names from the
// file we analyzed (`1. Sales Calculator`, `2. Our P&L`).
//
// Once named ranges exist in the workbook, the engine prefers them and these
// become dead code (but harmless — kept as a permanent failsafe).

export const CELL_FALLBACKS: Record<string, string> = {
  // ── Inputs (Sheet 1) ──
  customer_name: `'1. Sales Calculator'!C6`,
  country: `'1. Sales Calculator'!C7`,
  seats: `'1. Sales Calculator'!C9`,
  customer_annual_revenue: `'1. Sales Calculator'!C10`,
  customer_annual_labor_cost: `'1. Sales Calculator'!C11`,
  ebitda_pct: `'1. Sales Calculator'!C12`,
  consultant_base_rate: `'1. Sales Calculator'!C18`,
  consultant_count: `'1. Sales Calculator'!C20`,
  consultant_hours: `'1. Sales Calculator'!C21`,
  travel_per_consultant: `'1. Sales Calculator'!C25`,
  hotel_nightly_rate: `'1. Sales Calculator'!C26`,
  llm_cost_per_person_day: `'1. Sales Calculator'!C29`,
  pilot_people_observed: `'1. Sales Calculator'!C30`,
  pilot_observation_days: `'1. Sales Calculator'!C31`,
  pilot_discount: `'1. Sales Calculator'!C35`,
  impl_integration_hrs_per_emp: `'1. Sales Calculator'!C39`,
  impl_workflow_hrs_per_emp: `'1. Sales Calculator'!C40`,
  impl_training_hrs_per_emp: `'1. Sales Calculator'!C41`,
  impl_calibration_hrs_per_emp: `'1. Sales Calculator'!C42`,
  impl_pm_hours: `'1. Sales Calculator'!C43`,
  impl_travel_budget: `'1. Sales Calculator'!C47`,
  seat_base_price: `'1. Sales Calculator'!C55`,
  improvement_subscription: `'1. Sales Calculator'!C58`,
  automatable_work_pct: `'1. Sales Calculator'!C63`,
  tier1_pct: `'1. Sales Calculator'!C67`,
  tier2_pct: `'1. Sales Calculator'!C68`,
  tier3_pct: `'1. Sales Calculator'!C69`,
  tier4_pct: `'1. Sales Calculator'!C70`,

  // ── Outputs (Sheet 1) ──
  effective_seat_price: `'1. Sales Calculator'!C57`,
  pilot_price: `'1. Sales Calculator'!C36`,
  implementation_price: `'1. Sales Calculator'!C50`,
  implementation_minus_pilot_credit: `'1. Sales Calculator'!C52`,
  monthly_platform: `'1. Sales Calculator'!C82`,
  monthly_agents: `'1. Sales Calculator'!C83`,
  monthly_improvement: `'1. Sales Calculator'!C84`,
  monthly_total: `'1. Sales Calculator'!C86`,
  annual_recurring: `'1. Sales Calculator'!C87`,
  year_1_total: `'1. Sales Calculator'!C88`,
  est_profit_increase: `'1. Sales Calculator'!C93`,
  roi_after_impl: `'1. Sales Calculator'!C94`,
  payback_months: `'1. Sales Calculator'!C95`,
  weighted_capture_rate: `'1. Sales Calculator'!C73`,
  monthly_agent_rev_per_emp: `'1. Sales Calculator'!C74`,

  // ── Outputs (Sheet 2: P&L) ──
  year_1_revenue: `'2. Our P&L'!C23`,
  year_1_gross_profit: `'2. Our P&L'!C24`,
};

// ─── Deal prefill ──────────────────────────────────────────────────────────

interface DealLike {
  company?: string | null;
  contact_email?: string | null;
  fields?: Record<string, unknown> | null;
}

/**
 * Prefill known fields from a deal record. Anything we don't have a value for
 * stays undefined so the form falls back to the schema's default.
 */
export function prefillFromDeal(deal: DealLike | null): Partial<PricingInputs> {
  if (!deal) return {};
  const fields = deal.fields ?? {};
  const out: Partial<PricingInputs> = {};

  if (deal.company) out.customer_name = deal.company;

  const country = pickStr(fields.country) || pickStr(fields.hq_location);
  if (country) out.country = country;

  const seats = pickInt(fields.company_size) ?? pickInt(fields.seats);
  if (seats) out.seats = seats;

  const annualRev = pickNum(fields.annual_revenue);
  if (annualRev != null) out.customer_annual_revenue = annualRev;

  const laborCost = pickNum(fields.annual_labor_cost);
  if (laborCost != null) {
    out.customer_annual_labor_cost = laborCost;
  } else if (annualRev != null) {
    // Heuristic from the Excel: "If unknown, estimate ~30% of revenue".
    out.customer_annual_labor_cost = Math.round(annualRev * 0.3);
  }

  const ebitda = pickNum(fields.ebitda_pct);
  if (ebitda != null) out.ebitda_pct = ebitda > 1 ? ebitda / 100 : ebitda;

  return out;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function pickStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  return String(v);
}
function pickInt(v: unknown): number | null {
  const n = pickNum(v);
  if (n == null) return null;
  return Math.round(n);
}
function pickNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[, $€£%]/g, '').trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
