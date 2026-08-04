import { NextRequest } from 'next/server';
import pool from '@/lib/db';
import { requireApiKey, jsonWithCors, corsOptions } from '@/lib/public-api';
import { SALES_GATES, GRANT_GATES } from '@/lib/gates';

/**
 * GET /api/public/deals
 *
 * Server-to-server list endpoint. Returns slim deal summaries — enough to
 * decide which ones to fetch full details for (via /api/public/deals/[id]).
 *
 * Auth: shared `ONBOARDING_API_KEY` (see lib/public-api.ts).
 *
 * Query params:
 *   - `deal_type`     'sales' | 'grant'                          filter by pipeline
 *   - `gate`          integer                                    filter by exact gate
 *   - `status`        'won' | 'active' | 'all' (default: 'all')  shorthand: 'won' = at final gate,
 *                                                                'active' = below final gate
 *   - `updated_since` ISO 8601 timestamp                          for incremental syncs
 *   - `q`             string                                      case-insensitive substring match
 *                                                                 on company or name
 *   - `limit`         1..200 (default: 50)
 *   - `offset`        0+ (default: 0)
 *
 * Response shape:
 *   {
 *     data: [{ id, name, company, deal_type, gate, gate_name, value, currency,
 *              gate_entered_at, updated_at, has_onboarding }],
 *     pagination: { limit, offset, total, has_more }
 *   }
 *
 * Intentionally NOT included per row (call the single-deal endpoint for these):
 *   score, risk, verdict, flags, missing, notes, fields, contact_*
 */

export function OPTIONS(req: NextRequest) {
  return corsOptions(req);
}

const SALES_FINAL = SALES_GATES[SALES_GATES.length - 1].number;   // 9
const GRANT_FINAL = GRANT_GATES[GRANT_GATES.length - 1].number;   // 10

interface ListRow {
  id: string;
  name: string;
  company: string;
  deal_type: 'sales' | 'grant';
  gate: number;
  value: string | null;
  currency: string | null;
  gate_entered_at: string;
  updated_at: string;
  has_onboarding: boolean;
}

export async function GET(req: NextRequest) {
  const denial = requireApiKey(req);
  if (denial) return denial;

  const sp = req.nextUrl.searchParams;

  // ── Parse + validate query params (best-effort, clamp to safe ranges) ──
  const dealType = sp.get('deal_type');
  if (dealType && dealType !== 'sales' && dealType !== 'grant') {
    return jsonWithCors(req, { error: "deal_type must be 'sales' or 'grant'" }, 400);
  }

  const gateParam = sp.get('gate');
  let gateFilter: number | null = null;
  if (gateParam) {
    const g = Number.parseInt(gateParam, 10);
    if (Number.isNaN(g) || g < 1 || g > 12) {
      return jsonWithCors(req, { error: 'gate must be an integer between 1 and 12' }, 400);
    }
    gateFilter = g;
  }

  const status = (sp.get('status') ?? 'all').toLowerCase();
  if (!['all', 'won', 'active'].includes(status)) {
    return jsonWithCors(req, { error: "status must be 'all', 'won', or 'active'" }, 400);
  }

  const updatedSince = sp.get('updated_since');
  if (updatedSince) {
    const t = Date.parse(updatedSince);
    if (Number.isNaN(t)) {
      return jsonWithCors(req, { error: 'updated_since must be an ISO 8601 timestamp' }, 400);
    }
  }

  const q = sp.get('q')?.trim() || null;

  const limit = clamp(Number.parseInt(sp.get('limit') ?? '50', 10) || 50, 1, 200);
  const offset = Math.max(0, Number.parseInt(sp.get('offset') ?? '0', 10) || 0);

  // ── Build the WHERE clause + params ──
  const clauses: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (dealType) { clauses.push(`d.deal_type = $${i++}`); values.push(dealType); }
  if (gateFilter !== null) { clauses.push(`d.gate = $${i++}`); values.push(gateFilter); }
  if (updatedSince) { clauses.push(`d.updated_at >= $${i++}`); values.push(updatedSince); }
  if (q) {
    clauses.push(`(d.company ILIKE $${i} OR d.name ILIKE $${i})`);
    values.push(`%${q}%`);
    i++;
  }

  // status: 'won' means at the type-appropriate final gate; 'active' below it.
  // When deal_type is unset, we OR both pipelines so the filter still works.
  if (status === 'won' || status === 'active') {
    const op = status === 'won' ? '=' : '<';
    if (dealType === 'sales') {
      clauses.push(`d.gate ${op} $${i++}`);
      values.push(SALES_FINAL);
    } else if (dealType === 'grant') {
      clauses.push(`d.gate ${op} $${i++}`);
      values.push(GRANT_FINAL);
    } else {
      // Cross-type: respect each pipeline's own final gate
      clauses.push(`(
        (d.deal_type = 'sales' AND d.gate ${op} $${i})
        OR (d.deal_type = 'grant' AND d.gate ${op} $${i + 1})
      )`);
      values.push(SALES_FINAL, GRANT_FINAL);
      i += 2;
    }
  }

  const allClauses = ['d.deleted_at IS NULL', ...clauses];
  const where = `WHERE ${allClauses.join(' AND ')}`;

  try {
    // Total count (same WHERE, no LIMIT/OFFSET) — only run when offset=0
    // OR an explicit `include_total=true`, to keep cheap pagination cheap.
    // For simplicity always run it; it uses the same indexes as the data query.
    const totalQ = await pool.query<{ n: string }>(
      `SELECT COUNT(*) as n FROM deals d ${where}`,
      values
    );
    const total = Number.parseInt(totalQ.rows[0]?.n ?? '0', 10);

    // Data page. `has_onboarding` now means "this deal is linked to a customer
    // in the PM tool". It used to mean "a client_onboardings row exists", and
    // that table was retired on 2026-08-03 when the PM tool took over
    // onboarding. The field NAME is kept deliberately: this is a published
    // contract and the PM tool itself consumes it, so renaming would break the
    // one caller we have. Both meanings answer the same question — has this
    // deal left sales?
    //
    // Only CONFIRMED links count, the same rule as everywhere else: an
    // unconfirmed proposal is a guess and must not change what anyone sees.
    const dataValues = [...values, limit, offset];
    const { rows } = await pool.query<ListRow>(
      `SELECT d.id, d.name, d.company, d.deal_type, d.gate, d.value, d.currency,
              d.gate_entered_at, d.updated_at,
              EXISTS(SELECT 1 FROM delivery_links dl
                      WHERE dl.deal_id = d.id AND dl.confirmed_at IS NOT NULL) AS has_onboarding
       FROM deals d
       ${where}
       ORDER BY d.updated_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      dataValues
    );

    const data = rows.map((r) => ({
      id: r.id,
      name: r.name,
      company: r.company,
      deal_type: r.deal_type,
      gate: r.gate,
      gate_name: gateName(r.deal_type, r.gate),
      value: r.value ? Number(r.value) : null,
      currency: r.currency,
      gate_entered_at: r.gate_entered_at,
      updated_at: r.updated_at,
      has_onboarding: r.has_onboarding,
    }));

    return jsonWithCors(req, {
      data,
      pagination: {
        limit,
        offset,
        total,
        has_more: offset + data.length < total,
      },
    });
  } catch (err) {
    console.error('[GET /api/public/deals]', err);
    return jsonWithCors(req, { error: 'Internal error' }, 500);
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function gateName(type: 'sales' | 'grant', gate: number): string | null {
  const pipeline = type === 'grant' ? GRANT_GATES : SALES_GATES;
  return pipeline.find((g) => g.number === gate)?.name ?? null;
}
