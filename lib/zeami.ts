/**
 * Zeami platform API — the calls SalesBrain makes INTO Zeami (handover of 2026-10-21; Zeami's copy lives in
 * matebackend docs/Api_integrations/SALESBRAIN_ONBOARDING_API.md). Server-only.
 *
 *   GET  /api/platform/v1/sales-crm/onboarding?deal_id=…        where the client's setup stands (deal page)
 *   PUT  /api/platform/v1/sales-crm/onboarding/support-group     add the support group once (deal page)
 *   POST /api/platform/v1/sales-crm/deal-events                  deal.won / deal.sales_rep_changed (lib/zeami-sync.ts)
 *
 * The other direction (Zeami reading `sales_rep` from GET /api/public/deals/[id]) uses our ONBOARDING_API_KEY.
 * This direction uses a DIFFERENT secret, Zeami's SALESBRAIN_INBOUND_API_KEY, stored here as ZEAMI_API_KEY.
 * Without ZEAMI_API_URL + ZEAMI_API_KEY nothing is called and the panel says so. Zeami answers 503 until it has
 * set its side of the key, 401 when the key is wrong.
 */

export const ZEAMI_BASE_PATH = '/api/platform/v1';

/** Who counts as a deal's sales rep: the assigned person (deals.lead_id), else the creator. A partner app's
 *  provisioned stub (…@<app>.service.salesbrain) and the agent's own service user are never a sales rep — Zeami
 *  could not match them to a person. Join as `rep` against a `deals d`. */
export const SALES_REP_JOIN = `
  LEFT JOIN LATERAL (
    SELECT u.name, lower(u.email) AS email
      FROM users u
     WHERE u.id IN (d.lead_id, d.user_id)
       AND u.email NOT LIKE '%.service.salesbrain'
       AND u.email <> 'agent@salesbrain.internal'
     ORDER BY (u.id = d.lead_id) DESC NULLS LAST
     LIMIT 1
  ) rep ON true`;

export interface ZeamiStage { key: string; label: string; done: boolean; current: boolean; detail: string }

export interface ZeamiOnboarding {
  found: boolean;
  company: { slug: string; name: string };
  status: 'not_started' | 'setting_up' | 'live' | string;
  stages: ZeamiStage[];
  project_manager: string | null;
  sales_person: string | null;
  backup_project_manager: string | null;
  backup_sales_person: string | null;
  support_group: { name: string; link: string } | null;
  signed_in: { count: number; total: number } | null;
  went_live_at: string | null;
}

export type ZeamiDealEventType = 'deal.won' | 'deal.sales_rep_changed';

export interface ZeamiResponse<T = unknown> {
  /** HTTP status; 0 = Zeami is not configured here, -1 = no answer (network, timeout). */
  status: number;
  body: T | null;
  error?: string;
}

export function zeamiConfigured(): boolean {
  return Boolean(process.env.ZEAMI_API_URL && process.env.ZEAMI_API_KEY);
}

export async function zeamiFetch<T = unknown>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  timeoutMs = 10_000,
): Promise<ZeamiResponse<T>> {
  const base = (process.env.ZEAMI_API_URL || '').replace(/\/+$/, '');
  const key = process.env.ZEAMI_API_KEY || '';
  if (!base || !key) return { status: 0, body: null, error: 'Zeami is not configured (ZEAMI_API_URL / ZEAMI_API_KEY)' };
  try {
    const res = await fetch(`${base}${ZEAMI_BASE_PATH}${path}`, {
      method,
      headers: { 'X-API-Key': key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
    const msg = parsed && typeof parsed === 'object'
      ? String((parsed as Record<string, unknown>).error ?? (parsed as Record<string, unknown>).detail ?? (parsed as Record<string, unknown>).message ?? '')
      : '';
    return { status: res.status, body: parsed as T | null,
             error: res.ok ? undefined : (msg || text.slice(0, 200) || `HTTP ${res.status}`) };
  } catch (err) {
    return { status: -1, body: null, error: err instanceof Error ? `${err.name}: ${err.message}` : 'no answer' };
  }
}

/** One sentence for a non-200 answer, for people. */
export function zeamiProblem(r: ZeamiResponse<unknown>): string {
  if (r.status === 0) return 'The Zeami link is not set up on this server yet.';
  if (r.status === -1) return `Zeami did not answer (${r.error}).`;
  if (r.status === 503) return 'Zeami has not switched this link on yet (its SalesBrain key is not set).';
  if (r.status === 401) return 'Zeami refused our key. The ZEAMI_API_KEY here does not match its SALESBRAIN_INBOUND_API_KEY.';
  return `Zeami answered ${r.status}${r.error ? `: ${r.error}` : ''}.`;
}
