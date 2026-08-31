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
    name: 'crm_icp_define',
    description:
      "Create or update a named ideal-customer profile for this employee: who to look for " +
      "(filters) and what makes them a fit (criteria + weights). Re-run with the same name to refine.",
    inputSchema: obj(
      {
        name: { type: 'string' },
        product: { type: 'string', description: 'zeami | chipchip' },
        description: { type: 'string' },
        search_keywords: { type: 'string' },
        filters: { type: 'object', description: 'location[], industry[], function[], company[], tenure[]' },
        criteria: { type: 'object', description: 'titles[], seniority[], locations[], industries[], company_sizes[], exclude_titles[], exclude_companies[], weights{}' },
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

// Kernel tools exposed verbatim (name in → same crm_* name out).
const PASSTHROUGH = new Set([
  'crm_icp_define', 'crm_icp_preview', 'crm_icp_list', 'crm_leads_finder_run',
  'crm_agent_request_run', 'crm_enrich_prospect', 'crm_outreach_propose',
  'crm_outreach_pending', 'crm_outreach_decide', 'crm_linkedin_status',
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

    if (!ctx.ownerUserId) {
      return { status: 'error', error: 'X-On-Behalf-Of (employee_id) is required for this tool' };
    }
    const owner = ctx.ownerUserId;

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
