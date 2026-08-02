/**
 * MCP tool dispatch — converts a `tools/call` request into an actual
 * side effect against SalesBrain, with visibility scope enforcement.
 *
 * Design principles:
 *   1. NEVER trust the request's identity. Every tool that touches deal
 *      data runs its query with `WHERE user_id = $me OR lead_id = $me`
 *      (non-admin) — same rule as the web UI. This means even a
 *      malicious client can't ask "give me all deals" and get someone
 *      else's data.
 *   2. Admin-only tools reject non-admin callers explicitly. No silent
 *      no-ops.
 *   3. For tools that dispatch to an existing executor, we call the
 *      executor directly (no HTTP round-trip). Business logic lives in
 *      one place.
 *   4. New tools (`list_deals`, `get_pipeline_overview`, `add_deal_note`)
 *      have their own inline implementations here since there's no
 *      existing executor for them.
 */

import pool from '../db';
import { getMissingFields, SALES_GATES, GRANT_GATES } from '../gates';
import { loadRelevantLessons } from '../lessons';
import { appendMemory, removeMemory, loadMemoriesForPrompt } from '../memory';
import { sendEmail } from '../email';
import { kernelCall } from './kernel-rpc';
import { getToolDef } from './tool-definitions';
import type { AuthContext } from './auth';
import { enforceToolLimit } from './auth';
import { nudgePendingBoardDecisions } from '../telegram-notifications';

// ─── Public API ────────────────────────────────────────────────────

export interface DispatchResult {
  status: 'success' | 'error' | 'rate_limited';
  data?: unknown;
  error?: string;
}

/**
 * Route a tool call to its handler, enforcing access rules along the way.
 * Never throws — errors come back as `{ status: 'error', error }`.
 */
export async function dispatchTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: AuthContext,
): Promise<DispatchResult> {
  const def = await getToolDef(toolName);
  if (!def) return { status: 'error', error: `Unknown tool: ${toolName}` };

  // Admin gate: 'admin' tools reject non-admin callers.
  if (def._meta.access === 'admin' && !ctx.is_admin) {
    return { status: 'error', error: 'This tool requires admin access' };
  }

  // Anonymous group-chat callers get read-only access. Any write/admin tool
  // is refused with a friendly hint the agent can relay in-thread.
  if (ctx.read_only && def._meta.access !== 'read') {
    return {
      status: 'error',
      error: 'read_only_context: link your SalesBrain account (DM me /start LINK-XXXXXX) to change data.',
    };
  }

  // Per-tool rate limits (send_telegram / send_email have tighter caps).
  if (!enforceToolLimit(ctx.token_id, toolName)) {
    return { status: 'rate_limited', error: `Per-tool rate limit exceeded for ${toolName}` };
  }

  try {
    const data = await run(toolName, args, ctx);
    return { status: 'success', data };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ─── Handler dispatch ──────────────────────────────────────────────

async function run(
  name: string,
  args: Record<string, unknown>,
  ctx: AuthContext,
): Promise<unknown> {
  switch (name) {
    // ── Read tools ─────────────────────────────────────────────
    case 'get_deal':                return getDeal(String(args.deal_id), ctx);
    case 'list_deals':              return listDeals(args, ctx);
    case 'get_pipeline_overview':   return pipelineOverview(ctx);
    case 'get_relevant_lessons':    return relevantLessons(String(args.deal_id), Number(args.limit) || 3, ctx);
    case 'get_memories':            return getMemories(String(args.scope || 'both'), ctx);
    case 'list_sales_leads':        return listSalesLeads(args);
    case 'get_sales_lead':          return getSalesLead(String(args.id));
    case 'list_pending_board_decisions': return listPendingBoardDecisions();

    // ── Write tools ────────────────────────────────────────────
    case 'update_deal':             return updateDeal(args, ctx);
    case 'add_deal_note':           return addDealNote(args, ctx);
    case 'create_deal':             return createDeal(args, ctx);
    case 'mark_deal_lost':          return markDealLost(args, ctx);
    case 'assess_deal':             return assessDeal(args, ctx);
    case 'schedule_followup':       return scheduleFollowup(args, ctx);
    case 'remember':                return remember(args, ctx);
    case 'forget':                  return forget(args, ctx);

    // ── Deal-scoped side effects (visibility-scoped, not admin-gated) ─
    case 'send_telegram':           return sendTelegram(args, ctx);
    case 'send_email':              return handleSendEmail(args, ctx);
    case 'advance_gate':            return advanceGate(args, ctx);
    case 'convert_lead_to_deal':    return convertLeadToDeal(String(args.lead_id), ctx);
    case 'delete_deal':             return deleteDeal(String(args.deal_id), ctx);
    case 'restore_deal':            return restoreDeal(String(args.deal_id), ctx);
    case 'nudge_pending_votes':     return nudgePendingVotes(args, ctx);

    default:
      // Everything the ring exposes. No per-tool arm is needed: the catalogue
      // came from the ring, so the argument names the client saw are already
      // the kernel's own — nothing to reshape. This is what lets a tool added
      // to the ring work over MCP with no change here.
      //
      // The legacy arms above DO reshape (`new_gate` → `gate`,
      // `type` → `type_`); they exist only for the old unprefixed names.
      if (name.startsWith('crm_')) return kernelCall(name, args, ctx.user_id);
      throw new Error(`Handler missing for tool: ${name}`);
  }
}

// ─── Visibility helper — the "WHERE" clause the DB filters on ────

/**
 * Build the visibility SQL fragment + params for scoping deal queries.
 * Non-admins see only deals they created or lead. Admins see everything.
 * ALWAYS excludes soft-deleted rows (`deleted_at IS NULL`) — no MCP
 * client ever sees a deleted deal, even admins (they use the web UI's
 * trash view for restore).
 *
 * Returns the WHERE fragment (without the leading "WHERE") plus the
 * bind values, so callers can compose it with additional filters.
 */
function dealVisibility(ctx: AuthContext, paramStartIdx = 1): { sql: string; params: unknown[]; nextIdx: number } {
  if (ctx.is_admin) return { sql: 'd.deleted_at IS NULL', params: [], nextIdx: paramStartIdx };
  return {
    sql: `d.deleted_at IS NULL AND (d.user_id = $${paramStartIdx} OR d.lead_id = $${paramStartIdx})`,
    params: [ctx.user_id],
    nextIdx: paramStartIdx + 1,
  };
}

// ─── Read handlers ────────────────────────────────────────────────

async function getDeal(dealId: string, ctx: AuthContext): Promise<Record<string, unknown> | null> {
  const vis = dealVisibility(ctx, 2);
  const { rows } = await pool.query(
    `SELECT d.*, u.name AS lead_name, u.email AS lead_email
     FROM deals d
     LEFT JOIN users u ON u.id = d.lead_id
     WHERE d.id = $1 AND ${vis.sql}`,
    [dealId, ...vis.params],
  );
  if (rows.length === 0) return null;
  const deal = rows[0] as Record<string, unknown>;

  // Enrich with gate metadata and missing fields (same shape the agent sees).
  const gates = deal.deal_type === 'grant' ? GRANT_GATES : SALES_GATES;
  const gate = gates.find((g) => g.number === deal.gate);
  const missing = getMissingFields(deal.gate as number, (deal.fields as Record<string, unknown>) || {}, (deal.deal_type as string) || 'sales');

  return {
    ...deal,
    gate_meta: gate ? { name: gate.name, isBoard: gate.isBoard, slaDays: gate.slaDays, description: gate.description } : null,
    missing_required_fields: missing,
  };
}

async function listDeals(args: Record<string, unknown>, ctx: AuthContext) {
  const dealType = String(args.deal_type || 'all');
  const gate = args.gate !== undefined ? Number(args.gate) : null;
  const status = String(args.status || 'active');
  const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));

  const wheres: string[] = [];
  const params: unknown[] = [];
  const vis = dealVisibility(ctx, params.length + 1);
  wheres.push(vis.sql);
  params.push(...vis.params);

  if (dealType !== 'all') {
    params.push(dealType);
    wheres.push(`d.deal_type = $${params.length}`);
  }
  if (gate !== null) {
    params.push(gate);
    wheres.push(`d.gate = $${params.length}`);
  }
  if (status !== 'all') {
    params.push(status);
    wheres.push(`d.status = $${params.length}`);
  }
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT d.id, d.name, d.company, d.deal_type, d.gate, d.status, d.score, d.risk,
            d.verdict, d.value, d.currency, d.updated_at, u.name AS lead_name
     FROM deals d
     LEFT JOIN users u ON u.id = d.lead_id
     WHERE ${wheres.join(' AND ')}
     ORDER BY d.updated_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return { deals: rows, count: rows.length };
}

async function pipelineOverview(ctx: AuthContext) {
  const vis = dealVisibility(ctx);
  const { rows } = await pool.query(
    `SELECT d.deal_type, d.gate, d.status, COUNT(*)::int AS count
     FROM deals d
     WHERE ${vis.sql}
     GROUP BY d.deal_type, d.gate, d.status
     ORDER BY d.deal_type, d.gate`,
    vis.params,
  );
  return { by_gate: rows, total: rows.reduce((sum, r) => sum + Number(r.count), 0) };
}

async function relevantLessons(dealId: string, limit: number, ctx: AuthContext) {
  const vis = dealVisibility(ctx, 2);
  const { rows: dealRows } = await pool.query(
    `SELECT id, deal_type, gate, value FROM deals d WHERE d.id = $1 AND ${vis.sql}`,
    [dealId, ...vis.params],
  );
  if (dealRows.length === 0) return { lessons: [], matched_deal: null };
  const lessons = await loadRelevantLessons(dealRows[0]);
  return { lessons: lessons.slice(0, limit), matched_deal: dealRows[0].id };
}

async function getMemories(scope: string, ctx: AuthContext) {
  const mem = await loadMemoriesForPrompt(ctx.user_email);
  if (scope === 'org') return { org: mem.org, user: [] };
  if (scope === 'user') return { org: [], user: mem.user };
  return mem;
}

// App feature (legacy org/user memory store — distinct from the Hermes
// relationship graph). Kept in TS on memory.ts.
async function remember(args: Record<string, unknown>, ctx: AuthContext) {
  const scope: 'org' | 'user' = args.scope === 'user' ? 'user' : 'org';
  if (scope === 'user' && !ctx.user_email) {
    return { error: 'Cannot save a user-scoped memory: no user context. Use scope="org".' };
  }
  const fact = String(args.fact);
  const memId = await appendMemory(scope, fact, { userEmail: ctx.user_email, byEmail: ctx.user_email });
  return { saved: true, mem_id: memId, scope, fact };
}

async function forget(args: Record<string, unknown>, ctx: AuthContext) {
  const result = await removeMemory(String(args.mem_id), { userEmail: ctx.user_email, byEmail: ctx.user_email });
  if (!result.removed) return { removed: false, error: `No memory found with id ${String(args.mem_id)}` };
  return { removed: true, scope: result.scope };
}

async function listSalesLeads(args: Record<string, unknown>) {
  const status = String(args.status || 'new');
  const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (status !== 'all') {
    params.push(status);
    wheres.push(`status = $${params.length}`);
  }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT id, full_name, company, email, status, booking_status, booked_at, created_at
     FROM sales_leads
     ${wheres.length ? 'WHERE ' + wheres.join(' AND ') : ''}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return { leads: rows, count: rows.length };
}

async function getSalesLead(id: string) {
  const { rows } = await pool.query(
    `SELECT sl.*, d.name AS converted_deal_name, d.gate AS converted_deal_gate
     FROM sales_leads sl
     LEFT JOIN deals d ON d.id = sl.converted_deal_id
     WHERE sl.id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function listPendingBoardDecisions() {
  const { rows } = await pool.query(
    `SELECT bd.id, bd.gate, bd.votes_required, bd.votes_to_block, bd.created_at,
            d.id AS deal_id, d.name AS deal_name, d.company,
            COALESCE(
              json_agg(
                json_build_object('name', bv.voter_name, 'vote', bv.vote)
                ORDER BY bv.created_at
              ) FILTER (WHERE bv.id IS NOT NULL),
              '[]'::json
            ) AS voters
     FROM board_decisions bd
     JOIN deals d ON d.id = bd.deal_id AND d.deleted_at IS NULL
     LEFT JOIN board_votes bv ON bv.board_decision_id = bd.id
     WHERE bd.status = 'pending' AND bd.gate >= d.gate
     GROUP BY bd.id, d.id
     ORDER BY bd.created_at ASC`,
  );
  return rows.map((r) => {
    const voters = r.voters as Array<{ name: string; vote: 'proceed' | 'stop' | 'amend' }>;
    const tally = { proceed: 0, stop: 0, amend: 0 };
    for (const v of voters) tally[v.vote] = (tally[v.vote] ?? 0) + 1;
    const daysPending = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000);
    return {
      deal_id: r.deal_id,
      deal_name: r.deal_name,
      company: r.company,
      gate: r.gate,
      votes_required: r.votes_required,
      votes_to_block: r.votes_to_block,
      tally,
      voters,
      votes_still_needed_to_proceed: Math.max(0, r.votes_required - tally.proceed),
      days_pending: daysPending,
    };
  });
}

// ─── Write handlers ───────────────────────────────────────────────

async function updateDeal(args: Record<string, unknown>, ctx: AuthContext) {
  // Routed to the kernel: it enforces visibility (via the acting user) plus the
  // grant money-first guard, gate events, and board/won notifications.
  return kernelCall('crm_update_deal', {
    deal_id: String(args.deal_id),
    updates: (args.updates as Record<string, unknown>) || {},
  }, ctx.user_id);
}

async function addDealNote(args: Record<string, unknown>, ctx: AuthContext) {
  const dealId = String(args.deal_id);
  const note = String(args.note).trim();
  if (!note) throw new Error('Note is required');

  const vis = dealVisibility(ctx, 2);
  const timestamp = new Date().toISOString();
  const header = `\n\n--- HERMES ${timestamp} ---\n`;

  const { rowCount, rows } = await pool.query(
    `UPDATE deals d
     SET notes = COALESCE(d.notes, '') || $1
     WHERE d.id = $2 AND ${vis.sql}
     RETURNING d.id, d.notes`,
    [header + note, dealId, ...vis.params],
  );
  if (rowCount === 0) throw new Error('Deal not found or not accessible');
  return { deal_id: rows[0].id, note_appended: true, note_length_chars: (rows[0].notes as string).length };
}

async function createDeal(args: Record<string, unknown>, ctx: AuthContext) {
  const name = String(args.name || '').trim();
  const company = String(args.company || '').trim();
  const dealType = String(args.deal_type || 'sales');
  if (!name || !company) throw new Error('name and company are required');
  if (dealType !== 'sales' && dealType !== 'grant') throw new Error('deal_type must be sales or grant');

  const missing = getMissingFields(1, {}, dealType);
  const { rows } = await pool.query(
    `INSERT INTO deals (name, company, contact_name, contact_email, value, currency, notes, user_id, lead_id, deal_type, missing)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10)
     RETURNING id, name, company, gate, deal_type`,
    [
      name, company,
      args.contact_name ?? null,
      args.contact_email ?? null,
      args.value ?? null,
      args.currency ?? 'USD',
      args.notes ?? null,
      ctx.user_id,
      dealType,
      missing,
    ],
  );
  return rows[0];
}

async function markDealLost(args: Record<string, unknown>, ctx: AuthContext) {
  return kernelCall('crm_mark_deal_lost', {
    deal_id: String(args.deal_id),
    reason: String(args.reason),
    root_cause: String(args.root_cause),
    lesson: String(args.lesson),
    competitor: args.competitor !== undefined ? String(args.competitor) : undefined,
  }, ctx.user_id);
}

async function assessDeal(args: Record<string, unknown>, ctx: AuthContext) {
  return kernelCall('crm_assess_deal', {
    deal_id: String(args.deal_id),
    score: Number(args.score),
    risk: String(args.risk),
    verdict: String(args.verdict),
    risk_signals: (args.risk_signals as string[]) || [],
    reasoning: String(args.reasoning),
  }, ctx.user_id);
}

async function scheduleFollowup(args: Record<string, unknown>, ctx: AuthContext) {
  return kernelCall('crm_schedule_followup', {
    deal_id: String(args.deal_id),
    type_: String(args.type),
    body: String(args.body),
    due_in_days: Number(args.due_in_days),
    subject: args.subject !== undefined ? String(args.subject) : undefined,
    to_email: args.to_email !== undefined ? String(args.to_email) : undefined,
  }, ctx.user_id);
}

async function sendTelegram(args: Record<string, unknown>, ctx: AuthContext) {
  // Legacy send_telegram posted a board review; that logic is now the kernel's
  // request_board_review (dedup per gate + decision row + Telegram delivery).
  return kernelCall('crm_request_board_review', {
    deal_id: String(args.deal_id),
    summary: String(args.message),
  }, ctx.user_id);
}

// App feature (no kernel equivalent): send a one-off email now, or draft it as
// a followup. Visibility-scoped like the web UI; uses the app's own mailer.
async function handleSendEmail(args: Record<string, unknown>, ctx: AuthContext) {
  const dealId = String(args.deal_id);
  const vis = dealVisibility(ctx, 2);
  const { rows } = await pool.query(
    `SELECT 1 FROM deals d WHERE d.id = $1 AND ${vis.sql}`,
    [dealId, ...vis.params],
  );
  if (rows.length === 0) throw new Error('Deal not found or not accessible');

  const to = String(args.to);
  const subject = String(args.subject);
  const body = String(args.body);
  if (args.send_immediately) {
    const { id } = await sendEmail({ to, subject, body });
    return { sent: true, email_id: id };
  }
  const { rows: fr } = await pool.query(
    `INSERT INTO followups (deal_id, type, subject, body, to_email, due_at)
     VALUES ($1, 'email', $2, $3, $4, now()) RETURNING id`,
    [dealId, subject, body, to],
  );
  return { drafted: true, followup_id: fr[0].id };
}

async function advanceGate(args: Record<string, unknown>, ctx: AuthContext) {
  const newGate = Number(args.new_gate);
  return kernelCall('crm_advance_gate', {
    deal_id: String(args.deal_id),
    gate: newGate,
    reason: args.reason !== undefined ? String(args.reason) : `Advanced to G${newGate} via MCP`,
  }, ctx.user_id);
}

async function deleteDeal(dealId: string, ctx: AuthContext) {
  const permClause = ctx.is_admin ? '' : 'AND (user_id = $2 OR lead_id = $2)';
  const params: unknown[] = ctx.is_admin ? [dealId, ctx.user_id] : [dealId, ctx.user_id];
  const { rowCount } = await pool.query(
    `UPDATE deals SET deleted_at = now(), deleted_by = $2
     WHERE id = $1 AND deleted_at IS NULL ${permClause}`,
    params,
  );
  if (rowCount === 0) throw new Error('Deal not found, already deleted, or permission denied');
  return { deleted: true, deal_id: dealId };
}

async function restoreDeal(dealId: string, ctx: AuthContext) {
  if (!ctx.is_admin) throw new Error('Only admins can restore deleted deals');
  const { rowCount } = await pool.query(
    `UPDATE deals SET deleted_at = NULL, deleted_by = NULL
     WHERE id = $1 AND deleted_at IS NOT NULL`,
    [dealId],
  );
  if (rowCount === 0) throw new Error('Deal not found or not currently deleted');
  return { restored: true, deal_id: dealId };
}

async function nudgePendingVotes(args: Record<string, unknown>, ctx: AuthContext) {
  // Admin-gated in the dispatcher (access: 'admin') — belt-and-braces here.
  if (!ctx.is_admin) throw new Error('Only admins can post board nudges');
  const onlyDealId = args.deal_id ? String(args.deal_id) : undefined;
  const result = await nudgePendingBoardDecisions({ onlyDealId, force: true });
  return {
    nudged_count: result.nudged,
    deal_ids: result.deal_ids,
    skipped: result.skipped,
    message: result.nudged === 0
      ? (onlyDealId
        ? 'No pending board decision for that deal — nothing to nudge.'
        : 'No pending board decisions — nothing to nudge.')
      : `Posted ${result.nudged} fresh reminder${result.nudged === 1 ? '' : 's'} in the board group.`,
  };
}

async function convertLeadToDeal(leadId: string, ctx: AuthContext) {
  // Delegate to the same transactional insert the HTTP endpoint uses.
  const { rows: leadRows } = await pool.query('SELECT * FROM sales_leads WHERE id = $1', [leadId]);
  const lead = leadRows[0];
  if (!lead) throw new Error('Lead not found');
  if (lead.status === 'converted' && lead.converted_deal_id) {
    return { deal_id: lead.converted_deal_id, already_converted: true };
  }

  const dealName = `${lead.company} — Demo request`;
  const missing = getMissingFields(1, {}, 'sales');
  const notes = lead.description ? `Demo request from zeami.io.\n\n--- Their message ---\n${lead.description}` : 'Demo request from zeami.io.';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: dealRows } = await client.query(
      `INSERT INTO deals (name, company, contact_name, contact_email, notes, missing, user_id, lead_id, deal_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 'sales')
       RETURNING id`,
      [dealName, lead.company, lead.full_name, lead.email, notes, missing, ctx.user_id],
    );
    const dealId = dealRows[0].id;
    await client.query(
      `UPDATE sales_leads SET status = 'converted', converted_deal_id = $1, converted_at = now(), converted_by = $2 WHERE id = $3`,
      [dealId, ctx.user_id, leadId],
    );
    await client.query('COMMIT');
    return { deal_id: dealId, already_converted: false };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
