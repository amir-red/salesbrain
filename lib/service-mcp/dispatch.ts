/**
 * Curated tool catalog + dispatcher for the service MCP surface.
 *
 * Most tools pass straight through to the kernel via kernelCall(tool, args,
 * ownerUserId) — the kernel enforces every gate (kill switch, budgets, quiet
 * hours, frequency/channel caps, ownership) off the resolved Actor, so the
 * sibling app cannot bypass policy. A few app-local tools (register_user,
 * list_leads, linkedin_*) have inline implementations here.
 *
 * `mcp=None` kernel tools (crm_outreach_propose) are reachable because ring
 * dispatch is by name; this surface deliberately exposes the send/spend tools
 * the public /api/mcp catalog hides.
 *
 * Shared-pool provenance: every row created here is owned by the employee's
 * provisioned user, and that user is in external_employees(app_key,
 * employee_id) — so external-origin data is always attributable to its app
 * without rewriting source columns.
 */

import pool from '../db';
import { kernelCall } from '../mcp/kernel-rpc';
import { registerEmployee } from './identity';
import { linkedinConnectStart, linkedinUnboundAccounts, linkedinLinkAccount } from './linkedin';
import { suggestIcp } from './icp-suggest';
import { nextWindowFor } from './schedule';

export interface ServiceDispatchResult {
  status: 'success' | 'error';
  data?: unknown;
  error?: string;
}

// ─── Catalog (what tools/list advertises) ──────────────────────────

type ToolDef = {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  needsOwner: boolean;   // false only for register_user
};

const obj = (
  properties: Record<string, unknown>,
  required: string[] = [],
): ToolDef['inputSchema'] => ({ type: 'object', properties, required });

export const SERVICE_TOOLS: ToolDef[] = [
  {
    name: 'register_user',
    description:
      "Register one of your employees. Provisions a SalesBrain owner for them and stores the " +
      "employee_id → owner mapping. Idempotent. Call once per employee before any other tool; " +
      "thereafter send the employee_id in the X-On-Behalf-Of header.",
    inputSchema: obj(
      {
        employee_id: { type: 'string', description: 'Your stable id for this employee' },
        name: { type: 'string' },
        email: { type: 'string' },
      },
      ['employee_id'],
    ),
    needsOwner: false,
  },
  {
    name: 'suggest_icp',
    description:
      "Optimize partial targeting into confirmable ICP CANDIDATES. Give any of website / product / description / " +
      "a partial criteria or filters (optionally a primary `objective`); returns 2-4 candidate ICPs, each a full " +
      "profile (filters + criteria + weights) SCORED 1-5 on all five objectives (speed_to_market, volume, margin, " +
      "logo, test_cases) with `objective_scores`, plus `assumptions` and `confidence`; `recommended_index` flags the " +
      "best fit. Saves nothing — show the candidates, let the user pick/edit, then call crm_icp_define. Run BEFORE sourcing.",
    inputSchema: obj({
      name: { type: 'string' },
      product: { type: 'string', description: 'zeami | chipchip' },
      website: { type: 'string' },
      description: { type: 'string' },
      criteria: { type: 'object', description: 'Any partial criteria you already have' },
      filters: { type: 'object', description: 'Any partial filters you already have' },
      objective: { type: 'string', enum: ['speed_to_market', 'volume', 'margin', 'logo', 'test_cases'],
                   description: 'Primary objective to optimize for; the recommended candidate is tuned to it' },
      n_candidates: { type: 'integer', description: 'How many candidate ICPs to return (2-4, default 3)' },
    }),
    needsOwner: false,
  },
  {
    name: 'crm_icp_define',
    description:
      'Create or update an ideal-customer profile for this employee: who to look for (filters) and ' +
      'what makes them a fit (criteria + weights). ' +
      'AN EMPLOYEE MAY HOLD MANY ICPs AT ONCE, AND `name` IS THE IDENTITY: a new name creates a new ' +
      'profile alongside the existing ones, an existing name updates that one in place. Pick a stable, ' +
      'distinct name per profile and do not paraphrase it between calls — re-sending a name you have ' +
      'used before overwrites that profile instead of adding one, and paraphrasing it creates a ' +
      'near-duplicate. There is no per-employee profile limit and no operator step. ' +
      'Call crm_icp_list first to see what already exists, and crm_icp_archive to retire one.',
    inputSchema: obj(
      {
        name: {
          type: 'string',
          description:
            'The profile identity. New name = new profile; existing name = update that profile in place.',
        },
        product: { type: 'string', description: 'zeami | chipchip' },
        description: { type: 'string' },
        search_keywords: { type: 'string' },
        filters: {
          type: 'object',
          description:
            'location[], industry[], function[], company[], tenure[]. industry/location must use the ' +
            'closed vocabulary (see criteria below) — free prose resolves to no LinkedIn filter and is dropped.',
        },
        criteria: {
          type: 'object',
          description:
            'titles[], seniority[], locations[], industries[], company_sizes[], exclude_titles[], ' +
            'exclude_companies[], weights{}. CLOSED VOCABULARIES, matched exactly and dropped in silence ' +
            'when unrecognised: seniority must be lowercase keys from ' +
            'c_level | founder | vp | head | director | manager | senior ' +
            '("C-Level", "C-Suite", "Owner" and the like score NOTHING); industries and locations must be ' +
            'LinkedIn names such as "Financial Services", "Software Development", "United Kingdom". ' +
            'titles[] and exclude_titles[] are free text and are matched as keywords. ' +
            'Run suggest_icp first if unsure — it returns values already in the vocabulary.',
        },
      },
      ['name'],
    ),
    needsOwner: true,
  },
  {
    name: 'crm_icp_preview',
    description:
      "Dry-run ICP criteria against contacts on file — who it would pick and the fit distribution. " +
      "Writes nothing, spends no quota.",
    inputSchema: obj(
      { criteria: { type: 'object' }, limit: { type: 'integer' }, sample: { type: 'integer' } },
      ['criteria'],
    ),
    needsOwner: true,
  },
  {
    name: 'crm_icp_list',
    description: "List this employee's ICP profiles and how many prospects each has found.",
    inputSchema: obj({ include_inactive: { type: 'boolean' } }),
    needsOwner: true,
  },
  {
    name: 'crm_icp_archive',
    description:
      "Retire one of this employee's ICPs (soft): agents stop sourcing for it, existing prospects " +
      "keep their link to it. Use it to put a profile on standby; re-defining the same name with " +
      "crm_icp_define revives it.",
    inputSchema: obj({ icp_id: { type: 'string', description: 'UUID from crm_icp_list' } }, ['icp_id']),
    needsOwner: true,
  },
  {
    name: 'crm_icp_rescore',
    description:
      "Re-score every open prospect on an ICP's list with the ICP's current criteria — call it after " +
      "editing an ICP via crm_icp_define so existing leads reflect the new rules. Creates and " +
      "contacts nothing; returns the new fit distribution.",
    inputSchema: obj(
      { icp_id: { type: 'string', description: 'UUID from crm_icp_list' }, limit: { type: 'integer', description: 'default 2000' } },
      ['icp_id'],
    ),
    needsOwner: true,
  },
  {
    name: 'crm_leads_finder_run',
    description:
      "Run ONE Leads Finder step for an ICP now: search the next page, score + store new people, " +
      "research the best. Spends the LinkedIn daily search budget; use crm_agent_request_run to queue.",
    inputSchema: obj(
      { icp_id: { type: 'string' }, limit: { type: 'integer', description: '<=50' } },
      ['icp_id'],
    ),
    needsOwner: true,
  },
  {
    name: 'crm_agent_request_run',
    description: "Queue an agent run for an ICP; the background agent picks it up on its next tick.",
    inputSchema: obj(
      { agent: { type: 'string', enum: ['leads_finder', 'enricher'] }, icp_id: { type: 'string' } },
      ['agent', 'icp_id'],
    ),
    needsOwner: true,
  },
  {
    name: 'crm_enrich_prospect',
    description:
      "Run the Enricher on ONE prospect now: employer, company research + website, and an email " +
      "(free in-DB match + configured provider). Contacts no one.",
    inputSchema: obj(
      {
        prospect_id: { type: 'string' },
        kinds: { type: 'array', items: { type: 'string', enum: ['employer', 'research', 'email'] } },
      },
      ['prospect_id'],
    ),
    needsOwner: true,
  },
  {
    name: 'list_leads',
    description:
      "This employee's prospects for an ICP (or all their ICPs), best fit first, with contact, " +
      "company, score, stage, research summary, and reachability.",
    inputSchema: obj({
      icp_id: { type: 'string' },
      stage: { type: 'string' },
      min_score: { type: 'integer' },
      limit: { type: 'integer', description: '<=300' },
    }),
    needsOwner: true,
  },
  {
    name: 'get_run_status',
    description:
      "Track a queued or finished run. Give the run_id you got from crm_agent_request_run (or an icp_id " +
      "for its latest run) and get: status (requested / running / success / partial / error / skipped), " +
      "the counts, the skip `reason` verbatim, how many runs are queued ahead, the next timer window, " +
      "this employee's readiness, and the current lead count. This is the poll loop.",
    inputSchema: obj({
      run_id: { type: 'string', description: 'From crm_agent_request_run' },
      icp_id: { type: 'string', description: 'Alternative: the latest run for this ICP' },
    }),
    needsOwner: true,
  },
  {
    name: 'crm_agent_activity',
    description:
      "Recent runs for this employee — per run: status, trigger, source/query, analyzed / matched / new / " +
      "researched, why a tick was skipped, and any error. The Activity feed.",
    inputSchema: obj({
      agent: { type: 'string', enum: ['leads_finder', 'outreach', 'enricher'] },
      icp_id: { type: 'string' },
      limit: { type: 'integer', description: 'default 30' },
    }),
    needsOwner: true,
  },
  {
    name: 'crm_agent_status',
    description:
      "Are the background agents live for this employee: each agent's enabled flag, caps and schedule, its " +
      "last run and 24h totals, plus any LinkedIn account paused for agent work. " +
      "READ THE SWITCH CAREFULLY: `kill_switch: true` means agents are ALLOWED to run — it is the master " +
      "enable, not a brake — so `true` is the healthy value and `false` means everything is halted. The " +
      "response also carries `sourcing_paused`, the same fact stated the safe way round: " +
      "`sourcing_paused: false` means sourcing is running normally. Whether a particular agent runs is its " +
      "own `enabled` flag, not this one.",
    inputSchema: obj({}),
    needsOwner: true,
  },
  {
    name: 'crm_linkedin_quota',
    description:
      "This employee's LinkedIn budget for the day: searches and profile fetches used vs the safe cap, " +
      "remaining, when it resumes, account tier, and pause state. Call it before sourcing to know whether " +
      "a run can happen at all.",
    inputSchema: obj({}),
    needsOwner: true,
  },
  {
    name: 'crm_outreach_propose',
    description:
      "File a first-message DRAFT for this employee to approve. Sends nothing. Email needs an email " +
      "handle on the person; LinkedIn needs an EXISTING thread id (no cold invites). One pending draft " +
      "per person. Surface the pending draft in YOUR UI and resolve it with crm_outreach_decide.",
    inputSchema: obj(
      {
        person_id: { type: 'string' },
        prospect_id: { type: 'string' },
        channel: { type: 'string', enum: ['email', 'linkedin'] },
        message: { type: 'string' },
        subject: { type: 'string', description: 'Email only' },
        rationale: { type: 'string' },
        linkedin_thread_id: { type: 'string', description: 'LinkedIn only' },
      },
      ['person_id', 'channel', 'message'],
    ),
    needsOwner: true,
  },
  {
    name: 'crm_outreach_pending',
    description: "This employee's outreach drafts awaiting a decision, with the card text. Render these in your UI.",
    inputSchema: obj({ limit: { type: 'integer' }, include_decided: { type: 'boolean' } }),
    needsOwner: true,
  },
  {
    name: 'crm_outreach_decide',
    description:
      "Approve or reject a pending draft as its owner. Approve SENDS it now through the policy gate " +
      "(quiet hours, caps) and reports the outcome — a denial at this moment is final. Reject files it as skipped.",
    inputSchema: obj(
      { approval_id: { type: 'string' }, decision: { type: 'string', enum: ['approve', 'reject'] } },
      ['approval_id', 'decision'],
    ),
    needsOwner: true,
  },
  {
    name: 'linkedin_connect_start',
    description:
      "Mint a Unipile hosted-auth link for this employee to connect their LinkedIn. Return the url to " +
      "them; on completion call linkedin_link_account with the resulting unipile_account_id.",
    inputSchema: obj({
      success_redirect_url: { type: 'string' },
      failure_redirect_url: { type: 'string' },
    }),
    needsOwner: true,
  },
  {
    name: 'linkedin_unbound_accounts',
    description: "LinkedIn accounts on Unipile not yet bound to a SalesBrain user — pick the right id to link.",
    inputSchema: obj({}),
    needsOwner: true,
  },
  {
    name: 'linkedin_link_account',
    description: "Bind a specific unipile_account_id to this employee (owner-parametric). Idempotent.",
    inputSchema: obj({ unipile_account_id: { type: 'string' } }, ['unipile_account_id']),
    needsOwner: true,
  },
  {
    name: 'crm_linkedin_status',
    description: "Whether this employee has a connected LinkedIn account (and which).",
    inputSchema: obj({}),
    needsOwner: true,
  },
  {
    name: 'crm_linkedin_revoke',
    description:
      "Disconnect this employee's LinkedIn account: stops syncing and sending, and ends the session " +
      "at the provider (the Unipile account is deleted, so it stops being billed). Mirrored threads " +
      "are kept as history. Reconnect any time with linkedin_connect_start.",
    inputSchema: obj({}),
    needsOwner: true,
  },
];

const CATALOG = new Map(SERVICE_TOOLS.map((t) => [t.name, t]));

// ─── Dispatch ──────────────────────────────────────────────────────

/** Direct read of an employee's prospects for an ICP (mirror /api/icp/[id]/leads). */
async function listLeads(ownerUserId: string, args: Record<string, unknown>): Promise<unknown> {
  const values: unknown[] = [ownerUserId];
  const filters: string[] = [`(p.owner_user_id = $1 OR p.owner_user_id IS NULL)`];
  if (typeof args.icp_id === 'string' && args.icp_id) {
    values.push(args.icp_id);
    filters.push(`p.icp_profile_id = $${values.length}`);
  }
  if (typeof args.stage === 'string' && args.stage) {
    values.push(args.stage);
    filters.push(`p.stage = $${values.length}`);
  }
  const minScore = Number(args.min_score || 0);
  if (minScore > 0) {
    values.push(minScore);
    filters.push(`p.icp_score >= $${values.length}`);
  }
  const limit = Math.min(Number(args.limit) || 100, 300);
  const { rows } = await pool.query(
    `SELECT p.id, p.stage, p.icp_score, p.fit_label, p.qualification_reason, p.research_summary,
            p.source_type, p.source_detail, p.linkedin_public_id, p.candidate_location,
            p.network_degree, p.warm_paths, p.created_at, p.scored_at, p.engaged_at, p.converted_deal_id,
            p.icp_profile_id, c.full_name, c.title, c.email, c.linkedin_url,
            a.name AS company_name, a.industry, a.company_size
     FROM prospects p
     LEFT JOIN contacts c ON c.id = p.contact_id
     LEFT JOIN accounts a ON a.id = p.account_id
     WHERE ${filters.join(' AND ')}
     ORDER BY p.icp_score DESC NULLS LAST, p.created_at DESC LIMIT ${limit}`,
    values,
  );
  return { leads: rows };
}

/** Readiness: can this employee's agents do LinkedIn work at all right now? */
async function readinessFor(owner: string): Promise<Record<string, unknown>> {
  try {
    return (await kernelCall('crm_linkedin_quota', {}, owner)) as Record<string, unknown>;
  } catch {
    return { connected: null, note: 'readiness unavailable' };
  }
}

/**
 * The poll loop for a queued run. `crm_agent_request_run` hands back a run_id
 * and the timer mutates THAT SAME row (requested → running → success | partial |
 * error | skipped), so the id is a valid handle from queue to completion.
 * Owner-scoped SQL, like listLeads.
 */
async function getRunStatus(owner: string, args: Record<string, unknown>): Promise<unknown> {
  const runId = typeof args.run_id === 'string' ? args.run_id : null;
  const icpId = typeof args.icp_id === 'string' ? args.icp_id : null;

  const where: string[] = ['r.owner_user_id = $1'];
  const values: unknown[] = [owner];
  if (runId) { values.push(runId); where.push(`r.id = $${values.length}`); }
  else if (icpId) { values.push(icpId); where.push(`r.icp_profile_id = $${values.length}`); }

  const { rows } = await pool.query(
    `SELECT r.id, r.agent, r.status, r.trigger, r.source, r.started_at, r.finished_at,
            r.analyzed, r.matched, r.created, r.researched, r.detail, r.error,
            r.icp_profile_id, i.name AS icp_name
     FROM agent_runs r
     LEFT JOIN icp_profiles i ON i.id = r.icp_profile_id
     WHERE ${where.join(' AND ')}
     ORDER BY r.started_at DESC LIMIT 1`,
    values,
  );
  if (!rows.length) {
    return { found: false, message: runId ? `No run ${runId} for this employee.` : 'No runs yet for this employee.' };
  }
  const r = rows[0];
  const detail = (r.detail || {}) as Record<string, unknown>;
  const terminal = ['success', 'partial', 'error', 'skipped'].includes(r.status);

  const queued = await pool.query(
    `SELECT count(*)::int AS n FROM agent_runs WHERE agent = $1 AND status = 'requested'`, [r.agent]);
  const leads = await pool.query(
    r.icp_profile_id
      ? `SELECT count(*)::int AS n FROM prospects WHERE owner_user_id = $1 AND icp_profile_id = $2`
      : `SELECT count(*)::int AS n FROM prospects WHERE owner_user_id = $1`,
    r.icp_profile_id ? [owner, r.icp_profile_id] : [owner],
  );

  return {
    found: true,
    run_id: r.id, agent: r.agent, status: r.status, trigger: r.trigger, source: r.source,
    done: terminal,
    started_at: r.started_at, finished_at: r.finished_at,
    analyzed: r.analyzed, matched: r.matched, created: r.created, researched: r.researched,
    reason: (detail.reason as string) ?? null,   // why a tick was skipped, verbatim
    error: r.error ?? null,
    icp_id: r.icp_profile_id, icp_name: r.icp_name,
    detail,
    lead_count: leads.rows[0]?.n ?? 0,
    ...(terminal ? {} : {
      queued_runs: queued.rows[0]?.n ?? 0,
      queued_note: 'All runs queued for this agent drain on the same tick, budget permitting — this is a count, not a position.',
      next_tick_window: nextWindowFor(r.agent),
    }),
    readiness: await readinessFor(owner),
  };
}

// ─── LinkedIn safe-rate guard for the two spending tools ───────────
// Consult the account's daily LinkedIn budget before crm_leads_finder_run /
// crm_enrich_prospect. If it's spent (or the account is paused), DON'T spend a
// call — return a clear deferral the calling app can show its user, with when
// we'll resume. If it runs, attach the remaining budget and a warning when the
// account is near its safe limit, so the client is informed before it risks a block.

interface Budget { used: number; cap: number; remaining: number; resume_at: string | null }
interface Quota {
  connected: boolean; message?: string;
  unipile_account_id?: string; tier?: string; paused?: boolean; pause_reason?: string | null;
  search?: Budget; profile?: Budget; blocks_24h?: number; errors_24h?: number;
}

async function guardedLinkedinSpend(
  toolName: string, owner: string, rest: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const isSearch = toolName === 'crm_leads_finder_run';
  const label = isSearch ? 'search' : 'profile-fetch';

  let quota: Quota;
  try {
    quota = (await kernelCall('crm_linkedin_quota', {}, owner)) as unknown as Quota;
  } catch {
    // If the budget read fails, fall through to the tool — the kernel + the
    // ring-level guard still enforce every limit; we just can't pre-annotate.
    return kernelCall(toolName, rest, owner);
  }

  if (!quota.connected) {
    return { deferred: true, status: 'not_connected', message: quota.message, linkedin: quota };
  }
  if (quota.paused) {
    return {
      deferred: true, status: 'paused',
      message: 'This employee\'s LinkedIn account is paused to protect it — '
        + (quota.pause_reason || 'it hit a LinkedIn limit') + '. Resume it before more LinkedIn work.',
      linkedin: quota,
    };
  }

  const budget = (isSearch ? quota.search : quota.profile) as Budget | undefined;
  if (budget && budget.remaining <= 0) {
    const when = budget.resume_at
      ? `We'll resume automatically after ${budget.resume_at}.`
      : 'It resumes as the 24-hour window rolls forward.';
    return {
      deferred: true, status: 'rate_limited',
      message: `LinkedIn ${label} quota for this period is used (${budget.used}/${budget.cap} today). ${when}`,
      resume_at: budget.resume_at, linkedin: quota,
    };
  }

  // Under budget — run it, then report the fresh budget + a near-limit warning.
  const data = (await kernelCall(toolName, rest, owner)) as Record<string, unknown>;
  const fresh = (await kernelCall('crm_linkedin_quota', {}, owner).catch(() => quota)) as unknown as Quota;
  const b = (isSearch ? fresh.search : fresh.profile) as Budget | undefined;
  const warnings: string[] = [];
  if (b) {
    const near = Math.max(2, Math.ceil(b.cap * 0.2));
    if (b.remaining <= near) {
      warnings.push(`Only ${b.remaining} LinkedIn ${label}${b.remaining === 1 ? '' : 's'} left today for this account `
        + `(${b.used}/${b.cap}) — approaching the safe limit. It resumes after ${b.resume_at ?? 'the window rolls'}.`);
    }
  }
  if ((fresh.blocks_24h ?? 0) > 0) {
    warnings.push('This account was recently rate-limited by LinkedIn in the last 24h — proceeding cautiously.');
  }
  return { ...data, linkedin: fresh, ...(warnings.length ? { warnings } : {}) };
}

// Kernel tools exposed verbatim (name in → same crm_* name out).
const PASSTHROUGH = new Set([
  'crm_icp_define', 'crm_icp_preview', 'crm_icp_list', 'crm_icp_archive',
  'crm_icp_rescore', 'crm_leads_finder_run',
  'crm_agent_request_run', 'crm_enrich_prospect', 'crm_outreach_propose',
  'crm_outreach_pending', 'crm_outreach_decide', 'crm_linkedin_status',
  'crm_linkedin_revoke', 'crm_agent_activity', 'crm_agent_status', 'crm_linkedin_quota',
]);

/**
 * Route one tool call. `ownerUserId` is null only for register_user (which
 * establishes the mapping); every other tool requires a resolved owner.
 */
export async function dispatchServiceTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: { appKey: string; ownerUserId: string | null },
): Promise<ServiceDispatchResult> {
  const def = CATALOG.get(toolName);
  if (!def) return { status: 'error', error: `Unknown tool: ${toolName}` };

  try {
    if (toolName === 'register_user') {
      const out = await registerEmployee(ctx.appKey, String(args.employee_id ?? ''), {
        name: typeof args.name === 'string' ? args.name : undefined,
        email: typeof args.email === 'string' ? args.email : undefined,
      });
      return { status: 'success', data: out };
    }

    if (toolName === 'suggest_icp') {
      const out = await suggestIcp({
        name: typeof args.name === 'string' ? args.name : undefined,
        product: typeof args.product === 'string' ? args.product : undefined,
        website: typeof args.website === 'string' ? args.website : undefined,
        description: typeof args.description === 'string' ? args.description : undefined,
        criteria: (args.criteria && typeof args.criteria === 'object') ? args.criteria as Record<string, unknown> : undefined,
        filters: (args.filters && typeof args.filters === 'object') ? args.filters as Record<string, unknown> : undefined,
        objective: typeof args.objective === 'string' ? args.objective : undefined,
        n_candidates: typeof args.n_candidates === 'number' ? args.n_candidates : undefined,
      });
      if ((out as { error?: string }).error) return { status: 'error', error: (out as { error: string }).error };
      return { status: 'success', data: out };
    }

    if (!ctx.ownerUserId) {
      return { status: 'error', error: 'X-On-Behalf-Of (employee_id) is required for this tool' };
    }
    const owner = ctx.ownerUserId;

    if (toolName === 'get_run_status') {
      return { status: 'success', data: await getRunStatus(owner, args) };
    }

    // Queueing a sourcing run for an employee with no connected LinkedIn would
    // sit in the queue and then silently skip forever. Refuse up front with the
    // fix, and never create the run.
    if (toolName === 'crm_agent_request_run') {
      const { employee_id: _drop2, ...rest } = args;
      const readiness = await readinessFor(owner) as { connected?: boolean | null; paused?: boolean; pause_reason?: string | null };
      if (readiness.connected === false) {
        return {
          status: 'success',
          data: {
            refused: true, status: 'not_connected',
            message: "No LinkedIn account is connected for this employee — sourcing can't run, so nothing was queued. "
              + 'Send them a connect link with linkedin_connect_start, then queue the run again.',
            readiness,
          },
        };
      }
      const out = (await kernelCall(toolName, rest, owner)) as Record<string, unknown>;
      const agent = typeof rest.agent === 'string' ? rest.agent : 'leads_finder';
      return {
        status: 'success',
        data: {
          ...out,
          status: 'requested',
          poll_with: 'get_run_status',
          next_tick_window: nextWindowFor(agent),
          readiness,
          ...(readiness.paused
            ? { warnings: [`This employee's LinkedIn account is paused (${readiness.pause_reason || 'paused for agents'}) — the queued run will skip until it is resumed.`] }
            : {}),
        },
      };
    }

    // LinkedIn-spending tools: check the safe-rate budget first, and either
    // defer with a clear "quota used — resumes at X" message, or run and attach
    // the remaining-budget + a near-limit warning so the caller can inform its user.
    if (toolName === 'crm_leads_finder_run' || toolName === 'crm_enrich_prospect') {
      const { employee_id: _drop, ...rest } = args;
      return { status: 'success', data: await guardedLinkedinSpend(toolName, owner, rest) };
    }

    // `kill_switch: true` means agents are ALLOWED to run — the field is the
    // master enable, not a brake. A partner agent read it the other way round
    // and reported to its user that sourcing was paused at the provider, which
    // was the opposite of the truth. Ship the same fact under a name that
    // cannot be misread, alongside the original (renaming it would break
    // /agents and the ring, which both read `kill_switch`).
    if (toolName === 'crm_agent_status') {
      const { employee_id: _drop, ...rest } = args;
      const out = (await kernelCall(toolName, rest, owner)) as Record<string, unknown>;
      return {
        status: 'success',
        data: { ...out, sourcing_paused: out.kill_switch === false },
      };
    }

    if (PASSTHROUGH.has(toolName)) {
      const { employee_id: _drop, ...rest } = args;
      return { status: 'success', data: await kernelCall(toolName, rest, owner) };
    }
    if (toolName === 'list_leads') {
      return { status: 'success', data: await listLeads(owner, args) };
    }
    if (toolName === 'linkedin_connect_start') {
      return {
        status: 'success',
        data: await linkedinConnectStart({
          success_redirect_url: typeof args.success_redirect_url === 'string' ? args.success_redirect_url : undefined,
          failure_redirect_url: typeof args.failure_redirect_url === 'string' ? args.failure_redirect_url : undefined,
        }),
      };
    }
    if (toolName === 'linkedin_unbound_accounts') {
      return { status: 'success', data: { accounts: await linkedinUnboundAccounts() } };
    }
    if (toolName === 'linkedin_link_account') {
      return { status: 'success', data: await linkedinLinkAccount(owner, args) };
    }
    return { status: 'error', error: `Unhandled tool: ${toolName}` };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}
