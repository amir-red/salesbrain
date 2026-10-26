/**
 * Tell Zeami when a sales deal is won or its sales rep changes (handover part 2). Server-only.
 *
 * Zeami never calls us, and deals.gate / deals.lead_id have several writers (this app, the kernel's update_deal
 * from the agent and Telegram, grant signing, SQL). So instead of hooking each one, a sweep compares every won
 * sales deal with what Zeami was last told (`zeami_deal_sync`, core 074) and sends only the difference:
 *
 *   never told          → deal.won              (with the current sales rep, if any)
 *   told, rep differs   → deal.sales_rep_changed
 *
 * Run by the Hermes cron job `zeami-deal-sync` through the signed bridge (tool `zeami_deal_sync`). Any 200 counts
 * as told: `no_company_for_deal` needs no retry, because Zeami's setup wizard reads `sales_rep` from
 * GET /api/public/deals/[id] when the client is set up later. A 401 or 503 stops the run (every call would fail
 * the same way); other failures are retried next run. A 4xx rejection is not retried until the deal changes.
 */
import pool from '@/lib/db';
import { SALES_GATES } from '@/lib/gates';
import { SALES_REP_JOIN, zeamiConfigured, zeamiFetch, zeamiProblem, type ZeamiDealEventType } from '@/lib/zeami';

interface Candidate {
  deal_id: string;
  name: string;
  rep_name: string | null;
  rep_email: string | null;
  won_sent_at: string | null;
  told_rep: string | null;
  seq: number | null;
  last_event_id: string | null;
  last_result: string | null;
}

export interface SyncOutcome {
  deal_id: string;
  deal: string;
  type: ZeamiDealEventType;
  sales_rep: string | null;
  result: string;
  error?: string;
}

export interface SyncReport {
  configured: boolean;
  dry_run: boolean;
  checked: number;
  sent: SyncOutcome[];
  failed: SyncOutcome[];
  stopped?: string;
  error?: string;
}

// Won = the last sales stage (6 since the six-stage pipeline of 2026-10-26; it was 9).
const FINAL_SALES_GATE = SALES_GATES[SALES_GATES.length - 1].number;

export async function syncZeamiDealEvents(opts: { dryRun?: boolean; dealId?: string } = {}): Promise<SyncReport> {
  const dryRun = Boolean(opts.dryRun);
  const report: SyncReport = { configured: zeamiConfigured(), dry_run: dryRun, checked: 0, sent: [], failed: [] };
  if (!report.configured && !dryRun) return report;

  const { rows } = await pool.query<Candidate>(
    `SELECT d.id AS deal_id, d.name, rep.name AS rep_name, rep.email AS rep_email,
            s.won_sent_at, s.rep_email AS told_rep, s.seq, s.last_event_id, s.last_result
       FROM deals d
       ${SALES_REP_JOIN}
       LEFT JOIN zeami_deal_sync s ON s.deal_id = d.id
      WHERE d.deleted_at IS NULL AND d.deal_type = 'sales'
        AND (d.gate >= $1 OR d.status = 'won')
        AND ($2::uuid IS NULL OR d.id = $2::uuid)
      ORDER BY d.updated_at`,
    [FINAL_SALES_GATE, opts.dealId ?? null],
  );
  report.checked = rows.length;

  for (const c of rows) {
    let type: ZeamiDealEventType;
    if (!c.won_sent_at) type = 'deal.won';
    else if ((c.rep_email ?? null) !== (c.told_rep ?? null)) type = 'deal.sales_rep_changed';
    else continue;

    // Stable across retries, distinct for every real change (A → B → A is three events).
    const eventId = `sb:${c.deal_id}:${(c.seq ?? 0) + 1}:${type}:${c.rep_email ?? 'none'}`;
    if (c.last_event_id === eventId && c.last_result === 'rejected') continue;

    const outcome: SyncOutcome = { deal_id: c.deal_id, deal: c.name, type, sales_rep: c.rep_email, result: 'would_send' };
    if (dryRun) { report.sent.push(outcome); continue; }

    const r = await zeamiFetch<{ result?: string }>('POST', '/sales-crm/deal-events', {
      type,
      deal_id: c.deal_id,
      event_id: eventId,
      ...(c.rep_email ? { sales_rep: { name: c.rep_name ?? '', email: c.rep_email } } : {}),
    });

    if (r.status === 200) {
      outcome.result = String(r.body?.result ?? 'ok');
      await pool.query(
        `INSERT INTO zeami_deal_sync (deal_id, won_sent_at, rep_email, seq, last_type, last_event_id, last_result,
                                      last_error, last_attempt_at, failures, updated_at)
         VALUES ($1, now(), $2, 1, $3, $4, $5, NULL, now(), 0, now())
         ON CONFLICT (deal_id) DO UPDATE SET
           won_sent_at = COALESCE(zeami_deal_sync.won_sent_at, now()), rep_email = $2,
           seq = zeami_deal_sync.seq + 1, last_type = $3, last_event_id = $4, last_result = $5,
           last_error = NULL, last_attempt_at = now(), failures = 0, updated_at = now()`,
        [c.deal_id, c.rep_email, type, eventId, outcome.result],
      );
      report.sent.push(outcome);
      continue;
    }

    const stop = r.status === 401 || r.status === 503 || r.status === 0;
    const rejected = r.status >= 400 && r.status < 500 && !stop && r.status !== 408 && r.status !== 429;
    outcome.result = rejected ? 'rejected' : 'failed';
    outcome.error = zeamiProblem(r);
    await pool.query(
      `INSERT INTO zeami_deal_sync (deal_id, last_type, last_event_id, last_result, last_error, last_attempt_at, failures)
       VALUES ($1, $2, $3, $4, $5, now(), 1)
       ON CONFLICT (deal_id) DO UPDATE SET
         last_type = $2, last_event_id = $3, last_result = $4, last_error = $5,
         last_attempt_at = now(), failures = zeami_deal_sync.failures + 1, updated_at = now()`,
      [c.deal_id, type, eventId, outcome.result, outcome.error],
    );
    report.failed.push(outcome);
    if (stop) { report.stopped = outcome.error; break; }
  }
  return report;
}

/** What we last told Zeami about one deal, for the deal page. NULL before the first attempt or before 074. */
export async function zeamiSyncState(dealId: string) {
  try {
    const { rows } = await pool.query(
      `SELECT won_sent_at, rep_email, last_type, last_result, last_error, last_attempt_at
         FROM zeami_deal_sync WHERE deal_id = $1`, [dealId]);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
