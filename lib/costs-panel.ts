/**
 * Contract for /admin/costs — the shape of the kernel's `crm_cost_report`
 * (salesbrain-core commands/costs.py). Types and formatters only; client-safe.
 * Prices are applied in the kernel, so nothing here knows a rate.
 */

export interface CostBucket { usd: number; calls: number; tokens: number; unpriced_tokens: number }

export interface CostReport {
  window: { days: number; from: string; to: string };
  total_usd: number;
  monthly_run_rate_usd: number;
  categories: { name: string; usd: number }[];
  llm: {
    usd: number; calls: number; tokens: number; unpriced_tokens: number;
    by_surface: (CostBucket & { surface: string })[];
    by_feature: (CostBucket & { feature: string })[];
    by_model: (CostBucket & { model: string })[];
    by_owner: (CostBucket & { owner: string })[];
    by_day: (CostBucket & { day: string })[];
  };
  unipile: {
    usd: number; monthly_fee_usd: number;
    accounts: { unipile_account_id: string; display_name: string | null; owner_name: string | null;
                active: boolean; days: number; usd: number }[];
    calls: Record<string, number>;
  };
  email_credits: { usd: number; by_source: { source: string; credits: number; usd: number }[] };
  fixed: { usd: number; items: { name: string; monthly_usd: number; usd: number }[]; unset: string[] };
  agents: { agent: string; runs: number; created: number; researched: number }[];
  unit_costs: {
    leads_created: number; per_lead_usd: number | null;
    drafts_approved: number; per_approved_draft_usd: number | null;
    replies: number; per_reply_usd: number | null;
    note: string;
  };
  gaps: string[];
  note: string;
}

export const WINDOWS = [7, 30, 90] as const;

export const SURFACE_LABELS: Record<string, string> = {
  hermes_turn: 'Agent turns (chat, Telegram, routines)',
  hermes_aux: 'Hermes auxiliary calls',
  ring_fallback: 'Cron scripts (research, classify)',
  app: 'App one-shot calls',
};

export const usd = (n: number | null | undefined): string =>
  n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const tokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
