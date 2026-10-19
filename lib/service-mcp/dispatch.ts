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
import { EXPORT_TOOL_DEFS, EXPORT_TOOL_KIND, exportTool } from '../export/tools';
import { adsOverview, dayTotals, providerTotals } from '../ads/overview';
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
        first_message_template: { type: 'string', description: 'Sent (as an approval card) to each person on this list who accepts a connection request. Placeholders {first_name} {full_name} {company}.' },
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
    name: 'crm_icp_set_state',
    description:
      'Start, hold or retire ONE ICP — the per-profile on/off switch, affecting only this profile and ' +
      'no other employee. `running`: agents source, enrich, draft and send for it. `paused`: all of ' +
      'that stops immediately while the profile, its leads and its history stay exactly as they are, ' +
      'and one call puts it back — use this for a temporary hold. `stopped`: retired and hidden from ' +
      'the default list. A pause set by a SalesBrain administrator can only be lifted by one; ' +
      'crm_icp_define does not clear a pause.',
    inputSchema: obj(
      {
        icp_id: { type: 'string', description: 'UUID from crm_icp_list' },
        state: { type: 'string', enum: ['running', 'paused', 'stopped'] },
        reason: { type: 'string', description: 'Shown wherever the hold is reported' },
      },
      ['icp_id', 'state'],
    ),
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
    description:
      'Queue an agent run; the background agent picks it up on its next tick. leads_finder and '
      + 'enricher work per ICP and need icp_id. graph_sync works per employee and takes no icp_id.',
    inputSchema: obj(
      {
        agent: { type: 'string', enum: ['leads_finder', 'enricher', 'graph_sync'] },
        icp_id: { type: 'string', description: 'Required for leads_finder and enricher' },
      },
      ['agent'],
    ),
    needsOwner: true,
  },
  {
    name: 'crm_agent_set_user_state',
    description:
      'Pause, stop or continue ONE background agent for THIS employee. `paused` and `stopped` both mean ' +
      'the agent never plans them again until continued — nothing in flight is cancelled, and their ' +
      'queued runs wait. A hold set by a SalesBrain administrator can only be lifted by one. Read the ' +
      'current holds from crm_agent_status → user_states.',
    inputSchema: obj(
      {
        agent: { type: 'string', enum: ['leads_finder', 'enricher', 'graph_sync', 'outreach'] },
        state: { type: 'string', enum: ['running', 'paused', 'stopped'] },
        reason: { type: 'string', description: 'Shown wherever the hold is reported' },
      },
      ['agent', 'state'],
    ),
    needsOwner: true,
  },
  {
    name: 'crm_enrich_lead',
    description:
      "Enrich ONE sales-leads card, one step per call so a screen can show progress: step 'linkedin' (profile by name + company; " +
      "web search first, saved only on exactly one strong match, otherwise `candidates` to choose from), 'website' (company site), " +
      "'email' (free in-DB match, then the configured provider; honours the daily credit cap). Run them in that order; step 'pick' " +
      "saves a LinkedIn candidate the user chose (public_identifier). Fills ONLY empty fields on the card, never overwrites, no phone. " +
      "Runs as the lead's owner (their LinkedIn account and budgets); allowed for the lead's back / front office, its owner and admins. " +
      "Returns {status: found | already | none | pick | weak | capped | skipped | duplicate | error, message, filled, candidates}. Contacts no one.",
    inputSchema: obj(
      {
        lead_id: { type: 'string' },
        step: { type: 'string', enum: ['linkedin', 'website', 'email', 'pick'] },
        public_identifier: { type: 'string', description: "for step 'pick': the chosen profile slug" },
        member_id: { type: 'string', description: "for step 'pick': the candidate's provider_id, if given" },
      },
      ['lead_id', 'step'],
    ),
    needsOwner: true,
  },
  {
    name: 'crm_enrich_prospect',
    description:
      "Run the Enricher on ONE prospect now: the LinkedIn profile found by name + company when the lead " +
      "has none (one search; attached only on exactly one strong match, otherwise candidates are kept — " +
      "see crm_linkedin_find_person / crm_linkedin_link_prospect), employer, company research + website, " +
      "and an email (free in-DB match + configured provider). Contacts no one.",
    inputSchema: obj(
      {
        prospect_id: { type: 'string' },
        kinds: { type: 'array', items: { type: 'string', enum: ['linkedin', 'employer', 'research', 'email'] } },
      },
      ['prospect_id'],
    ),
    needsOwner: true,
  },
  {
    name: 'crm_linkedin_find_person',
    description:
      "Search LinkedIn for a lead's profile by name + company (pass prospect_id) and return the " +
      "candidates with the strong ones marked. Writes nothing — your user picks, then call " +
      "crm_linkedin_link_prospect. One search on the employee's LinkedIn account.",
    inputSchema: obj(
      {
        prospect_id: { type: 'string', description: 'A lead from list_leads with no linkedin_public_id' },
        name: { type: 'string', description: 'Free search instead of a lead: the name' },
        company: { type: 'string' },
        limit: { type: 'integer', default: 5 },
      },
      [],
    ),
    needsOwner: true,
  },
  {
    name: 'crm_linkedin_link_prospect',
    description:
      "Attach a LinkedIn profile to a lead that has none — your user's pick among the candidates. " +
      "Refuses to overwrite an existing profile; returns duplicate_of when the same profile is already " +
      "another lead of theirs (one person, two companies).",
    inputSchema: obj(
      {
        prospect_id: { type: 'string' },
        public_identifier: { type: 'string', description: 'The vanity slug or profile URL' },
        member_id: { type: 'string', description: 'provider_id from the candidate, if known' },
      },
      ['prospect_id', 'public_identifier'],
    ),
    needsOwner: true,
  },
  {
    name: 'crm_prospect_add',
    description:
      "Add ONE lead by hand for this employee — a business card, an event note, a referral — so it goes " +
      "through the same journey as a sourced lead (enrich, route, approve, send, reply). Never duplicates: " +
      "an existing lead with the same LinkedIn profile, email, or name at the same company is returned " +
      "(created=false, matched_by) with its blanks filled in and nothing overwritten. Scored against icp_id " +
      "or the employee's single active ICP, else it lands unscored (P0_IMPORTED). `notes` become a dossier " +
      "fact. Contacts no one.",
    inputSchema: obj(
      {
        full_name: { type: 'string' },
        company: { type: 'string' },
        title: { type: 'string', description: 'Role / job title' },
        email: { type: 'string' },
        phone: { type: 'string', description: 'One number; put a second one in notes' },
        linkedin_url: { type: 'string', description: 'Profile URL or vanity slug' },
        website: { type: 'string', description: 'Company website' },
        location: { type: 'string', description: 'Where the person is based' },
        address: { type: 'string', description: 'Company postal address' },
        notes: { type: 'string', description: 'Where you met, what was agreed, who introduced' },
        icp_id: { type: 'string', description: 'From crm_icp_list' },
        source_detail: { type: 'string', description: "e.g. 'business card, Fakuma 2026'" },
      },
      ['full_name'],
    ),
    needsOwner: true,
  },
  {
    name: 'list_leads',
    description:
      "This employee's prospects for an ICP (or all their ICPs), best fit first, with contact, " +
      "company, score, stage, research summary, reachability, and the send history: " +
      "last_contacted_at, touch_count, next_followup_at, last_replied_at, reply_status " +
      "(stage P6_REPLIED = they answered; follow-ups stop automatically).",
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
      agent: { type: 'string', enum: ['leads_finder', 'outreach', 'enricher', 'graph_sync'] },
      icp_id: { type: 'string' },
      limit: { type: 'integer', description: 'default 30' },
    }),
    needsOwner: true,
  },
  {
    name: 'crm_pipeline_summary',
    description:
      "The deal side of a stand-up, org-wide: active deals by type and gate with value; in the period — created, " +
      "moved gate (from→to), won (+value), lost, contracts signed; board decisions still pending; deal follow-ups " +
      "overdue. Deal names only. period: today | yesterday | week | last_week | month | 7d | 30d.",
    inputSchema: obj({ period: { type: 'string', default: 'week' } }),
    needsOwner: true,
  },
  {
    name: 'crm_team_kpis',
    description:
      "crm_outreach_kpis for every teammate doing outreach, in ONE call — the whole stand-up table. Aggregates only.",
    inputSchema: obj({ period: { type: 'string', default: 'today' }, limit: { type: 'integer', default: 12 } }),
    needsOwner: true,
  },
  {
    name: 'crm_lead_lookup',
    description:
      "Where are we with <person / company>? Finds leads by name, email, company or LinkedIn slug — org-wide, the " +
      "owner's name is part of the answer — and returns each one's journey: stage, owner, ICP + fit, LinkedIn " +
      "connection state, last message sent (snippet), last reply, follow-up timer, cards awaiting approval, " +
      "converted deal, and a plain `next_step`. Nothing matched → graph people with that name (add with crm_prospect_add).",
    inputSchema: obj({ query: { type: 'string' }, limit: { type: 'integer', default: 5 } }, ['query']),
    needsOwner: true,
  },
  {
    name: 'crm_lead_note',
    description:
      "Record what happened with a lead: a dated note on their dossier. kind = meeting / call / email / linkedin " +
      "also logs an outbound interaction. Target by prospect_id, person_id, or a `query` that matches exactly one " +
      "lead (several → `candidates`, pick and call again). Appended to the /sales-leads row when one exists. Sends nothing.",
    inputSchema: obj(
      {
        note: { type: 'string' },
        prospect_id: { type: 'string' },
        person_id: { type: 'string' },
        query: { type: 'string', description: 'Name / company to resolve the lead by' },
        kind: { type: 'string', enum: ['note', 'meeting', 'call', 'email', 'linkedin'], default: 'note' },
        when: { type: 'string', description: 'YYYY-MM-DD if not today' },
      },
      ['note'],
    ),
    needsOwner: true,
  },
  {
    name: 'crm_followups_due',
    description:
      "Who needs a follow-up: leads whose cadence timer is due (or within N days) with their last message and " +
      "whether a follow-up draft already awaits approval, deal follow-ups overdue, AND sales_leads — /sales-leads rows whose " +
      "ping-by date is reached or that went quiet 14+ days where the owner is back OR front office (each row names both). " +
      "owner = a teammate's name / email, 'me', or 'all'. 'What is due for me today?' = owner 'me'.",
    inputSchema: obj({
      owner: { type: 'string', default: 'all' },
      within_days: { type: 'integer', default: 0 },
      limit: { type: 'integer', default: 50 },
    }),
    needsOwner: true,
  },
  {
    name: 'crm_list_sales_leads',
    description:
      "The team's inbound / sales-leads inbox (org-wide): zeami.io demo requests, Calendly bookings, every lead " +
      "we messaged or who replied, and hand-added cards. status: new (default) | contacted | replied | converted | archived | all, " +
      "or the dashboard views working (open leads ranked by priority) and due (ping-by date reached or quiet 14+ days). " +
      "Rows carry priority, must_talk, responsible/front, last/next contact and days_since_contact. " +
      "ROLES: responsible = BACK OFFICE (drives the lead: research, drafts, follow-ups, ping-by date), front = FRONT OFFICE " +
      "(the face: calls, demos, meetings; empty = back office does both). 'my leads' / 'Hannes's leads' = owner 'me' / a " +
      "teammate's name, role any | responsible | front.",
    inputSchema: obj({
      status: { type: 'string', default: 'new' },
      owner: { type: 'string', description: "teammate name / email, 'me', or omit for everyone" },
      role: { type: 'string', enum: ['any', 'responsible', 'front'], default: 'any' },
      limit: { type: 'integer', default: 20 },
    }),
    needsOwner: true,
  },
  {
    name: 'crm_get_sales_lead',
    description:
      "One sales-leads row in full: source, demo booking, whether converted, `roles` (back office / front office), " +
      "and the dated track record — each line with its `id` and `editable` (true = crm_edit_sales_lead_event will " +
      "accept it from you: hand-written, and yours unless you are an admin). Use the id to correct or delete a line.",
    inputSchema: obj({ lead_id: { type: 'string' } }, ['lead_id']),
    needsOwner: true,
  },
  {
    name: 'crm_update_sales_lead',
    description:
      "Work a sales-leads row the way the dashboard does: status new | contacted | replied | archived; a dated " +
      "track-record line (note_kind 'note', or a contact event met | sent | reply | call | meeting that moves the " +
      "'last contact' ticker; occurred_at YYYY-MM-DD backdates it); priority 1 (top) … 10 (0 clears), rank = order inside the priority (0 clears); must_talk; " +
      "responsible (BACK OFFICE: drives the lead — gets the due digest and reply notices) / front (FRONT OFFICE: calls, demos; " +
      "gets booking notices, becomes the deal lead) teammate by name — a newly assigned person is DM'd; next_contact_at " +
      "YYYY-MM-DD; met_at (where we met); and the card itself — full_name / title / company / email / linkedin_url " +
      "(corrections are logged), phone, website, next_step (the next envisioned step: no way in yet = connect on LinkedIn first, connected = reach out; crm_get_sales_lead returns linkedin + suggested_next_step) and the journey: journey_stage 0–5, intro_quality 1–5, journey_outcome qualified | lost. " +
      "Any combination. Converting is crm_convert_lead.",
    inputSchema: obj(
      {
        lead_id: { type: 'string' },
        status: { type: 'string', enum: ['new', 'contacted', 'replied', 'archived'] },
        note: { type: 'string' },
        note_kind: { type: 'string', enum: ['note', 'met', 'sent', 'reply', 'call', 'meeting'], default: 'note' },
        channel: { type: 'string', enum: ['linkedin', 'email', 'phone', 'in_person', 'telegram', 'whatsapp'] },
        occurred_at: { type: 'string' },
        priority: { type: 'integer' },
        must_talk: { type: 'boolean' },
        responsible: { type: 'string' },
        front: { type: 'string' },
        next_contact_at: { type: 'string' },
        phone: { type: 'string', description: "the lead's phone number; '' clears" },
        website: { type: 'string', description: "the lead's website; '' clears" },
        next_step: { type: 'string', description: "the next envisioned step, free text, e.g. 'Connect on LinkedIn', 'Reach out: first message', 'Book the call'; '' clears" },
        met_at: { type: 'string' },
        rank: { type: 'integer', description: 'order inside the priority, 1 = first; 0 clears' },
        full_name: { type: 'string', description: 'correct the name on the card' },
        title: { type: 'string' },
        company: { type: 'string' },
        email: { type: 'string' },
        linkedin_url: { type: 'string' },
        journey_stage: { type: 'integer', description: '0 not started · 1 warm introduction · 2 connected on LinkedIn · 3 other channel · 4 call or meeting set · 5 qualified' },
        intro_quality: { type: 'integer', description: '1–5 how good the introduction was; 0 clears' },
        journey_outcome: { type: 'string', enum: ['qualified', 'lost', ''], description: "closes step 5; 'lost' also archives" },
      },
      ['lead_id'],
    ),
    needsOwner: true,
  },
  {
    name: 'crm_edit_sales_lead_event',
    description:
      "Correct one line of a lead's track record — text and/or date (YYYY-MM-DD). Hand-written lines only " +
      "(note / met / sent / reply / call / meeting), and only the employee's own unless they are an admin.",
    inputSchema: obj({ event_id: { type: 'string' }, text: { type: 'string' }, occurred_at: { type: 'string' }, delete: { type: 'boolean', description: 'remove a mistaken line' } }, ['event_id']),
    needsOwner: true,
  },
  {
    name: 'crm_convert_lead',
    description:
      "Turn a sales lead into a G1 sales deal. The deal's creator is the lead's BACK OFFICE and its project lead the FRONT " +
      "OFFICE (you, where a seat is empty), so both see it; the booked demo, website, where-met, their message and our notes go " +
      "into the deal notes; the track record gets the line and both roles are told. Idempotent.",
    inputSchema: obj({ lead_id: { type: 'string' } }, ['lead_id']),
    needsOwner: true,
  },
  {
    name: 'crm_prospect_convert',
    description:
      "Promote one of this employee's prospects to a G1 sales deal (name + value optional). Idempotent.",
    inputSchema: obj({ prospect_id: { type: 'string' }, deal_name: { type: 'string' }, value: { type: 'number' } }, ['prospect_id']),
    needsOwner: true,
  },
  {
    name: "crm_prospect_update",
    description: "Correct a lead: name, title, company, email, phone, LinkedIn profile, where the person is based, and your own order (priority_rank). Any combination. Company re-points the lead to the account of that name (found or created) and never renames the shared account. A LinkedIn profile already on another of your leads is refused with duplicate_of. Stage, score and sends are not editable here. The lead's /sales-leads row is kept in step and gets one 'edited …' line.",
    inputSchema: obj({
      "prospect_id": {
        "type": "string",
        "description": "UUID of the prospect (from crm_prospect_queue)"
      },
      "full_name": {
        "type": "string"
      },
      "title": {
        "type": "string"
      },
      "company": {
        "type": "string",
        "description": "'' clears"
      },
      "email": {
        "type": "string",
        "description": "'' clears"
      },
      "phone": {
        "type": "string"
      },
      "linkedin_url": {
        "type": "string",
        "description": "profile URL or vanity slug"
      },
      "location": {
        "type": "string",
        "description": "where the person is based"
      },
      "priority_rank": {
        "type": "integer",
        "description": "your own order, 1 = first; 0 clears"
      }
    }, ["prospect_id"]),
    needsOwner: true,
  },
  {
    name: "crm_prospect_get",
    description: "Full detail for one prospect: contact, company, fit score and reasoning, research.",
    inputSchema: obj({
      "prospect_id": {
        "type": "string",
        "description": "UUID of the prospect (from crm_prospect_queue)"
      }
    }, ["prospect_id"]),
    needsOwner: true,
  },
  {
    name: "crm_prospect_archive",
    description: "Stop working a prospect. Use disqualified=true when they are a bad fit (a judgement worth keeping), false when merely parked.",
    inputSchema: obj({
      "prospect_id": {
        "type": "string",
        "description": "UUID of the prospect (from crm_prospect_queue)"
      },
      "reason": {
        "type": "string"
      },
      "disqualified": {
        "type": "boolean",
        "default": false
      }
    }, ["prospect_id", "reason"]),
    needsOwner: true,
  },
  {
    name: "crm_icp_set_first_message",
    description: "Set (or clear with empty text) the first message a list sends once a connection request is accepted: the hourly sync files ONE approval card per acceptance from it — 👍 sends, 👎 skips, nothing goes out by itself. Placeholders {first_name} {full_name} {company}.",
    inputSchema: obj({
      "icp_id": {
        "type": "string",
        "description": "UUID from crm_icp_list"
      },
      "text": {
        "type": "string",
        "description": "The message, verbatim; empty clears it"
      }
    }, ["icp_id"]),
    needsOwner: true,
  },
  {
    name: "crm_get_deal",
    description: "Fetch one deal's full context: columns, fields, gate meta, SLA, missing fields.",
    inputSchema: obj({
      "deal_id": {
        "type": "string",
        "description": "UUID of the deal"
      }
    }, ["deal_id"]),
    needsOwner: true,
  },
  {
    name: "crm_list_my_deals",
    description: "List deals visible to the acting user. Filters: deal_type, gate, status.",
    inputSchema: obj({
      "deal_type": {
        "type": "string",
        "enum": [
          "sales",
          "grant"
        ]
      },
      "gate": {
        "type": "integer",
        "minimum": 1,
        "maximum": 10
      },
      "status": {
        "type": "string",
        "enum": [
          "active",
          "lost"
        ],
        "default": "active"
      },
      "limit": {
        "type": "integer",
        "default": 25
      }
    }, []),
    needsOwner: true,
  },
  {
    name: "crm_search_deals",
    description: "Find deals by name or company (case-insensitive substring). Use this to resolve 'the Acme deal' / 'the Kifiya one' when you don't have the id. RBAC-scoped to deals you can see.",
    inputSchema: obj({
      "query": {
        "type": "string",
        "description": "Name/company text to match"
      },
      "limit": {
        "type": "integer",
        "default": 25
      }
    }, ["query"]),
    needsOwner: true,
  },
  {
    name: "crm_update_deal",
    description: "Update a deal: direct columns (name, company, contact_*, gate, score, risk, verdict, notes, value, currency, owner, lead_id), a `fields` object (merged into JSONB), and/or flags. Advancing a grant past G1 is HARD-BLOCKED until all money fields are set (grant_amount_min/max, our_contribution, our_contribution_type, cofunding_split) — you may fill them in the same call. Gate changes write gate events, supersede stale board decisions, and fire board/won notifications. On this surface a gate change is refused: gate moves go through the board process in SalesBrain.",
    inputSchema: obj({
      "deal_id": {
        "type": "string",
        "description": "UUID of the deal"
      },
      "updates": {
        "type": "object",
        "description": "Keys: direct columns and/or fields/missing/flags"
      }
    }, ["deal_id", "updates"]),
    needsOwner: true,
  },
  {
    name: "crm_add_note",
    description: "Append a timestamped note to the deal (--- HERMES <ts> --- convention).",
    inputSchema: obj({
      "deal_id": {
        "type": "string",
        "description": "UUID of the deal"
      },
      "note": {
        "type": "string"
      }
    }, ["deal_id", "note"]),
    needsOwner: true,
  },
  {
    name: "crm_mark_deal_lost",
    description: "Mark a deal lost and record the structured lesson (reason = diagnosis, lesson = prescription). Idempotent.",
    inputSchema: obj({
      "deal_id": {
        "type": "string",
        "description": "UUID of the deal"
      },
      "reason": {
        "type": "string"
      },
      "root_cause": {
        "type": "string",
        "enum": [
          "price",
          "timeline",
          "fit",
          "decision_maker",
          "capability",
          "competition",
          "budget",
          "eligibility",
          "other"
        ]
      },
      "lesson": {
        "type": "string"
      },
      "competitor": {
        "type": "string"
      }
    }, ["deal_id", "reason", "root_cause", "lesson"]),
    needsOwner: true,
  },
  {
    name: "crm_schedule_followup",
    description: "Schedule a follow-up (email draft, reminder, or SLA alert) due in N days.",
    inputSchema: obj({
      "deal_id": {
        "type": "string",
        "description": "UUID of the deal"
      },
      "type_": {
        "type": "string",
        "enum": [
          "email",
          "reminder",
          "sla_alert"
        ]
      },
      "body": {
        "type": "string"
      },
      "due_in_days": {
        "type": "number"
      },
      "subject": {
        "type": "string"
      },
      "to_email": {
        "type": "string"
      }
    }, ["deal_id", "type_", "body", "due_in_days"]),
    needsOwner: true,
  },
  {
    name: 'export_sales_leads',
    description: EXPORT_TOOL_DEFS[0].description,
    inputSchema: EXPORT_TOOL_DEFS[0].inputSchema as ToolDef['inputSchema'],
    needsOwner: true,
  },
  {
    name: 'export_prospects',
    description: EXPORT_TOOL_DEFS[1].description,
    inputSchema: EXPORT_TOOL_DEFS[1].inputSchema as ToolDef['inputSchema'],
    needsOwner: true,
  },
  {
    name: 'export_icp',
    description: EXPORT_TOOL_DEFS[2].description,
    inputSchema: EXPORT_TOOL_DEFS[2].inputSchema as ToolDef['inputSchema'],
    needsOwner: true,
  },
  {
    name: 'marketing_overview',
    description:
      "Paid-ads performance (Google Ads + LinkedIn Ads) for the last N closed days, read live from the platforms " +
      "(10-min cache). `totals` per provider: spend, impressions, clicks, CTR, CPC, platform-reported conversions / " +
      "Lead Gen leads, spend on the last closed day and the day before (\"yesterday / today\" for a stand-up — " +
      "platforms close a day late). `campaigns` lists every campaign. A provider that is not configured or not " +
      "connected says so in `error` without hiding the other. `by_day` has one row per provider per day with " +
      "spend, impressions, clicks, CTR, CPM, CPC already computed — for \"13 October: LinkedIn spent X, Y " +
      "impressions, Z clicks, CTR, CPM, CPC\" read that row. Pass `day` (YYYY-MM-DD) for exactly one day. " +
      "Org-wide; no employee data.",
    inputSchema: obj({
      days: { type: 'integer', description: 'Closed days to cover, 1–365 (default 7)', default: 7 },
      day: { type: 'string', description: 'One specific day, YYYY-MM-DD (then days defaults to 1)' },
      include_campaigns: { type: 'boolean', description: 'Also list every campaign', default: false },
    }),
    needsOwner: true,
  },
  {
    name: 'crm_outreach_kpis',
    description:
      "Outreach KPIs for one teammate over one period — the stand-up numbers: connection requests sent / " +
      "accepted / pending, first messages and follow-ups sent, replies, new leads, leads researched / enriched, " +
      "contacted, calls booked, follow-ups due. `owner` is a NAME, email or LinkedIn handle (e.g. 'Matthias'); " +
      "SalesBrain resolves it to the teammate — omit it for the calling employee. An ambiguous name returns " +
      "`candidates` instead of numbers: ask the user which one. Aggregates only, never lead names.",
    inputSchema: obj({
      owner: { type: 'string', description: "Teammate name / email / LinkedIn handle; default = this employee" },
      period: {
        type: 'string',
        enum: ['today', 'yesterday', 'week', 'last_week', 'month', '7d', '30d'],
        default: 'today',
        description: 'week = Monday → now; 7d / 30d = rolling',
      },
    }),
    needsOwner: true,
  },
  {
    name: 'crm_memory_save',
    description:
      "Remember something about THIS employee or how they want work done: a correction ('our value proposition is " +
      "X, never Y'), a preference (language, tone), a rule, a fact about their accounts or team. One line, ≤300 " +
      "chars, the fact not the story. Saved to this employee's own notes in SalesBrain (scope personal) — read " +
      "them back with crm_memory_recall BEFORE drafting anything for them. scope team proposes it to every " +
      "SalesBrain user; an admin approves it. Secrets and pay data are refused. Tell the user what you saved.",
    inputSchema: obj({
      content: { type: 'string', description: 'The note, one line, ≤300 chars' },
      scope: { type: 'string', enum: ['personal', 'team'], default: 'personal',
               description: 'personal = only this employee; team = proposed to everyone (admin approves)' },
      kind: { type: 'string', enum: ['preference', 'fact', 'rule', 'procedure'], default: 'fact',
              description: 'rule = changes how you behave (shown first)' },
    }),
    needsOwner: true,
  },
  {
    name: 'crm_memory_recall',
    description:
      "This employee's active notes + the team's shared notes from SalesBrain (corrections, preferences, rules, " +
      "the value proposition …). CALL THIS BEFORE DRAFTING OR PITCHING ANYTHING for them and follow what it says — " +
      "it is how a correction given once stays corrected. Optional `query` filters by a word.",
    inputSchema: obj({ query: { type: 'string', description: 'Optional word to filter on' } }),
    needsOwner: true,
  },
  {
    name: 'crm_memory_forget',
    description: "Forget one of this employee's notes (superseded, never deleted). Use when they say 'forget that' " +
      "or correct an earlier note (save the new one first). `memory_id` from crm_memory_recall.",
    inputSchema: obj({ memory_id: { type: 'string' } }),
    needsOwner: true,
  },
  {
    name: 'crm_memory_share',
    description: "Promote one of this employee's personal notes to the whole SalesBrain team: files a team-scope " +
      "proposal a SalesBrain admin approves. Use when they say 'share that with the team'.",
    inputSchema: obj({ memory_id: { type: 'string' } }),
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
      "File a DRAFT for this employee to approve. Sends nothing. Email needs an email handle on the " +
      "person; LinkedIn needs an EXISTING thread id (no cold invites). One pending draft per person per " +
      "kind. Surface the pending draft in YOUR UI and resolve it with crm_outreach_decide — the approval " +
      "is the only way a message leaves (enforced in the kernel).",
    inputSchema: obj(
      {
        person_id: { type: 'string' },
        prospect_id: { type: 'string' },
        channel: { type: 'string', enum: ['email', 'linkedin'] },
        message: { type: 'string' },
        subject: { type: 'string', description: 'Email only' },
        rationale: { type: 'string' },
        linkedin_thread_id: { type: 'string', description: 'LinkedIn only' },
        kind: { type: 'string', enum: ['outreach', 'followup'], description: 'followup = touch N+1 to someone already contacted' },
        commercial: { type: 'boolean', description: 'True if the message contains an ask; shown on the card, drives the value gate at send' },
      },
      ['person_id', 'channel', 'message'],
    ),
    needsOwner: true,
  },
  {
    name: 'crm_record_reply',
    description:
      "Record that a contacted lead REPLIED (email or LinkedIn). Moves the lead to P6_REPLIED, stops the " +
      "follow-up cadence, logs the inbound interaction and tells the owner. Idempotent on ref (the provider " +
      "message id). Use when YOUR system sees a reply SalesBrain has not recorded.",
    inputSchema: obj(
      {
        channel: { type: 'string', enum: ['email', 'linkedin'] },
        ref: { type: 'string', description: 'Provider message id' },
        prospect_id: { type: 'string' },
        person_id: { type: 'string' },
        snippet: { type: 'string' },
        received_at: { type: 'string', description: 'ISO timestamp' },
      },
      ['channel', 'ref'],
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
  {
    name: 'crm_graph_status',
    description:
      "This employee's relationship graph: how many people and edges it holds by source, how strong "
      + 'they are, whether the LinkedIn 1st-degree mirror is complete or still paging, and how many of '
      + 'their imported contacts have been bridged into it. Reads only.',
    inputSchema: obj({}),
    needsOwner: true,
  },
  {
    name: 'crm_graph_edges',
    description:
      'The strongest people in this employee\'s graph — who they know best right now, with the evidence '
      + 'behind each score (messages exchanged, when the last signal was, which source it came from).',
    inputSchema: obj({
      limit: { type: 'integer', description: 'How many to return (default 50, max 500)' },
      source: {
        type: 'string',
        enum: ['linkedin_csv', 'linkedin_relation', 'linkedin_thread', 'email_thread', 'intro_confirmed', 'manual',
               'linkedin_mutual', 'email_cothread'],
        description: 'Only edges from this source',
      },
    }),
    needsOwner: true,
  },
  {
    name: 'crm_graph_reach',
    description:
      'How far this employee can reach through the team: how many people they know directly, how many '
      + 'more a teammate could introduce them to, what each connected teammate adds, and how many '
      + "teammates have not connected LinkedIn. Counts only — a teammate's contacts are never listed.",
    inputSchema: obj({}),
    needsOwner: true,
  },
  {
    name: 'crm_who_can_reach',
    description:
      'Who on the team could introduce this employee to a given person. Answers in hops: 1 if they '
      + 'already know them, 2 if a teammate does — naming that teammate and the evidence for the tie. '
      + "Returns only the route to THIS person, never the rest of a teammate's network.",
    inputSchema: obj(
      { person_id: { type: 'string', description: 'UUID from crm_graph_edges' } },
      ['person_id'],
    ),
    needsOwner: true,
  },
  {
    name: 'crm_graph_sync',
    description:
      "Build this employee's relationship graph now. The free sources — imported LinkedIn contacts, "
      + 'mirrored LinkedIn threads, synced email — always run, so an employee with no LinkedIn connected '
      + 'still gets a graph. The LinkedIn 1st-degree mirror pages only while today\'s relations budget '
      + 'allows and resumes on the next call. Contacts no one; spends no search or profile quota.',
    inputSchema: obj({
      sources: {
        type: 'array',
        items: { type: 'string', enum: ['contacts', 'threads', 'email', 'email_cothreads', 'relations', 'linkedin'] },
        description: 'Default: all of them',
      },
      max_pages: { type: 'integer', description: 'LinkedIn relations pages this call (default 2, max 5)' },
    }),
    needsOwner: true,
  },
  // ─── Route to a lead (journey step 5) ───────────────────────────
  {
    name: 'crm_path_find',
    description:
      'How to reach ONE lead: ranked routes from the employee to the lead through people they can message now. '
      + 'Colours: red = the employee or a teammate, blue = reachable now (email on file or an existing LinkedIn '
      + 'conversation), yellow = knows the lead but not reachable yet, green = the lead. Each hop carries the '
      + 'channel, the evidence in words, why that person, and whether it is actionable now. Returns a drawable '
      + '`graph` {nodes[{id,label,color,role,hop}], edges[{from,to,strength,channel}]} and `bridge_candidates` '
      + 'when no route exists. Read-only — spends nothing. The result is stored on the lead (`warm_paths`) and '
      + 'summarised on list_leads as best_path_hops / path_available.',
    inputSchema: obj({
      prospect_id: { type: 'string', description: 'The lead (preferred)' },
      person_id: { type: 'string', description: 'Any person instead of a lead' },
      max_hops: { type: 'integer', description: '1-3 (default 2)' },
      k: { type: 'integer', description: 'How many routes (default 3)' },
    }),
    needsOwner: true,
  },
  {
    name: 'crm_route_expand',
    description:
      'Look LinkedIn up to find a route to a lead, cheapest first: the lead\'s profile (employers, schools, '
      + 'degree, shared-connection count — 1 profile fetch), then for a 2nd-degree lead with shared connections '
      + "LinkedIn's own Connections-of search naming the employee's mutual connections (1-2 searches from a "
      + 'small daily sub-budget), then each teammate\'s account for a 1st-degree tie. Recomputes the route and '
      + 'returns the same shape as crm_path_find plus `expand` (what was spent and found). Sends nothing. '
      + 'Budget-guarded: a deferral envelope comes back when the account is paused or out of quota.',
    inputSchema: obj({ prospect_id: { type: 'string', description: 'The lead' } }, ['prospect_id']),
    needsOwner: true,
  },
  {
    name: 'crm_propose_intro',
    description:
      'File an INTRO-REQUEST draft: ask a connector (the first hop of a crm_path_find route — someone the '
      + 'employee can message now) to introduce them to the lead. The channel is picked from how the employee '
      + 'reaches the connector (existing LinkedIn thread, else email; never an invitation). Sends nothing: it '
      + 'appears in crm_outreach_pending with kind=intro_request; approving it via crm_outreach_decide sends '
      + "the ask to the connector. A sent ask never changes the lead's stage. Include a forwardable_blurb "
      + '(2-3 sentences the connector can paste to the lead) — the double-opt-in convention.',
    inputSchema: obj({
      connector_person_id: { type: 'string', description: "hops[0].to.person_id of a crm_path_find route" },
      lead_prospect_id: { type: 'string', description: 'The lead' },
      message: { type: 'string', description: "The ask, in the employee's voice" },
      forwardable_blurb: { type: 'string', description: 'What the connector can forward verbatim' },
      subject: { type: 'string', description: 'Email only' },
      path_id: { type: 'string', description: 'From crm_path_find, ties the ask to its route' },
      rationale: { type: 'string' },
    }, ['connector_person_id', 'lead_prospect_id', 'message']),
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
            p.icp_profile_id, p.person_id, c.full_name, c.title, c.email, c.linkedin_url,
            a.name AS company_name, a.industry, a.company_size,
            -- steps 7-9: what has gone out, whether they answered, when the next touch is due
            p.last_contacted_at, p.touch_count, p.next_followup_at, p.last_replied_at, p.reply_status,
            -- step 5 summary, from the stored route entry (crm_path_find)
            (SELECT (e->>'best_path_hops')::int FROM jsonb_array_elements(COALESCE(p.warm_paths, '[]'::jsonb)) e
              WHERE e->>'type' = 'route' LIMIT 1) AS best_path_hops,
            COALESCE((SELECT (e->>'path_available')::boolean FROM jsonb_array_elements(COALESCE(p.warm_paths, '[]'::jsonb)) e
              WHERE e->>'type' = 'route' LIMIT 1), false) AS path_available,
            (SELECT e->>'computed_at' FROM jsonb_array_elements(COALESCE(p.warm_paths, '[]'::jsonb)) e
              WHERE e->>'type' = 'route' LIMIT 1) AS route_computed_at,
            -- the Lead Conductor's stored verdict on the matching /sales-leads card (core 068)
            sl.id AS sales_lead_id, sl.lifecycle_stage, sl.lifecycle_actor, sl.lifecycle_step, sl.lifecycle_blocker
     FROM prospects p
     LEFT JOIN contacts c ON c.id = p.contact_id
     LEFT JOIN accounts a ON a.id = p.account_id
     LEFT JOIN sales_leads sl ON sl.prospect_id = p.id
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
  // crm_route_expand spends a profile fetch first and, only for a 2nd-degree
  // lead with shared connections, a search — the profile budget is the one it
  // always touches, so that is the one checked up front.
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
  'crm_icp_define', 'crm_icp_preview', 'crm_icp_list', 'crm_icp_archive', 'crm_icp_set_state',
  'crm_icp_rescore', 'crm_leads_finder_run',
  'crm_agent_request_run', 'crm_agent_set_user_state', 'crm_enrich_prospect', 'crm_enrich_lead', 'crm_outreach_propose',
  'crm_outreach_pending', 'crm_outreach_decide', 'crm_record_reply', 'crm_linkedin_status',
  'crm_linkedin_find_person', 'crm_linkedin_link_prospect', 'crm_prospect_add',
  'crm_linkedin_revoke', 'crm_agent_activity', 'crm_agent_status', 'crm_linkedin_quota', 'crm_outreach_kpis',
  'crm_graph_status', 'crm_graph_edges', 'crm_graph_sync',
  'crm_pipeline_summary', 'crm_team_kpis', 'crm_lead_lookup', 'crm_lead_note', 'crm_followups_due',
  'crm_list_sales_leads', 'crm_get_sales_lead', 'crm_update_sales_lead', 'crm_edit_sales_lead_event', 'crm_convert_lead', 'crm_prospect_convert',
  'crm_prospect_update', 'crm_prospect_get', 'crm_prospect_archive', 'crm_icp_set_first_message',
  'crm_get_deal', 'crm_list_my_deals', 'crm_search_deals', 'crm_update_deal', 'crm_add_note', 'crm_mark_deal_lost', 'crm_schedule_followup',
  'crm_graph_reach', 'crm_who_can_reach',
  'crm_path_find', 'crm_propose_intro',
  // Per-person memory: the employee's own notes (identity = X-On-Behalf-Of), team notes shared on approval.
  'crm_memory_save', 'crm_memory_recall', 'crm_memory_forget', 'crm_memory_share',
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
        user_id: ctx.ownerUserId ?? undefined,
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
      const agent = typeof rest.agent === 'string' ? rest.agent : 'leads_finder';
      // Only the sourcing agents are useless without LinkedIn. graph_sync
      // builds most of its edges from imported contacts and synced email, so
      // refusing it for an unconnected employee would withhold the one agent
      // that still works for them.
      const NEEDS_LINKEDIN = new Set(['leads_finder', 'enricher']);
      const readiness = await readinessFor(owner) as { connected?: boolean | null; paused?: boolean; pause_reason?: string | null };
      if (NEEDS_LINKEDIN.has(agent) && readiness.connected === false) {
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
      // A kernel refusal (paused ICP, per-person hold) carries its own
      // `status`; decorating it as 'requested' told the caller a run was queued
      // when nothing was.
      if (out.refused || out.error) return { status: 'success', data: out };
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
    if (toolName === 'crm_leads_finder_run' || toolName === 'crm_enrich_prospect' || toolName === 'crm_route_expand') {
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

    if (toolName in EXPORT_TOOL_KIND) {
      const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [owner]);
      return { status: 'success', data: await exportTool(toolName, args, { userId: owner, role: String(rows[0]?.role || 'user') }) };
    }
    if (toolName === 'crm_update_deal') {
      const upd = (args.updates && typeof args.updates === 'object') ? args.updates as Record<string, unknown> : {};
      if ('gate' in upd) {
        return { status: 'error', error: 'Gate moves are not available on this surface — the board process runs in SalesBrain. ' +
          'Update the other fields, or move the gate in the app.' };
      }
    }
    if (PASSTHROUGH.has(toolName)) {
      // owner_user_id is stripped too: an app holds only its own employee's agents.
      const { employee_id: _drop, owner_user_id: _own, ...rest } = args;
      return { status: 'success', data: await kernelCall(toolName, rest, owner) };
    }
    if (toolName === 'marketing_overview') {
      const day = typeof args.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.day) ? args.day : undefined;
      const o = await adsOverview(typeof args.days === 'number' ? args.days : (day ? 1 : 7), day);
      return {
        status: 'success',
        data: {
          days: o.days, since: o.since, until: o.until,
          totals: providerTotals(o),
          by_day: dayTotals(o),
          ...(args.include_campaigns === true ? { campaigns: o.providers.flatMap((p) => p.campaigns) } : {}),
          note: 'Spend is platform-reported in the account currency; conversions/leads are as reported by the ' +
                'platform, not CRM leads.',
        },
      };
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
