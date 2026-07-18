/**
 * MCP tool definitions — the JSON schemas exposed via `tools/list`.
 *
 * Kept as a pure data file (no imports) so we can regenerate docs
 * from it, feed it to schema-validation libraries, etc.
 *
 * Naming convention: `get_*` / `list_*` for reads; verb_noun (`update_deal`,
 * `mark_deal_lost`) for writes. Matches the existing `lib/tools.ts`
 * naming so tools that dispatch to an executor share the name.
 *
 * Every tool has a `_meta` block with:
 *   - `access`: 'read' | 'write' | 'admin' — controls what visibility
 *     scope and role checks tool-dispatch enforces
 *   - `dispatches_to` (optional): the existing executor name if we
 *     forward straight to `lib/tool-executors.ts`
 */

export type ToolAccess = 'read' | 'write' | 'admin';

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  _meta: {
    access: ToolAccess;
    dispatches_to?: string;
  };
}

// ─── Read tools ───────────────────────────────────────────────────

const READ_TOOLS: McpToolDef[] = [
  {
    name: 'get_deal',
    description:
      'Fetch the full context of one deal: fields, gate metadata, missing required fields, lead info, recent conversation summary. Returns null if the deal is not visible to the token owner.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'UUID of the deal' },
      },
      required: ['deal_id'],
    },
    _meta: { access: 'read' },
  },
  {
    name: 'list_deals',
    description:
      "Browse the deal pipeline visible to the token owner. Non-admins see only deals they created or are assigned as lead on. Filters are optional.",
    inputSchema: {
      type: 'object',
      properties: {
        deal_type: { type: 'string', enum: ['sales', 'grant', 'all'], description: 'Filter by pipeline. Default: all.' },
        gate: { type: 'number', description: 'Filter by gate number (1-10).' },
        status: { type: 'string', enum: ['active', 'lost', 'all'], description: 'Deal status. Default: active.' },
        limit: { type: 'number', minimum: 1, maximum: 100, description: 'Max rows. Default 20.' },
      },
    },
    _meta: { access: 'read' },
  },
  {
    name: 'get_pipeline_overview',
    description:
      'High-level snapshot of the pipeline visible to the token owner: total counts by gate for both sales and grant deals, plus board-pending and overdue counts.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    _meta: { access: 'read' },
  },
  {
    name: 'get_relevant_lessons',
    description:
      'Fetch past-loss lessons that are similar to a given deal (same deal_type, adjacent gate, similar value). Useful for cross-deal pattern recognition.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'The deal to fetch lessons FOR.' },
        limit: { type: 'number', minimum: 1, maximum: 20, description: 'Max lessons. Default 3.' },
      },
      required: ['deal_id'],
    },
    _meta: { access: 'read' },
  },
  {
    name: 'get_memories',
    description:
      'Load durable agent memories (org-wide team lessons + per-user preferences). Scope defaults to both.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['org', 'user', 'both'], description: 'Which memory scope. Default both.' },
      },
    },
    _meta: { access: 'read' },
  },
  {
    name: 'list_sales_leads',
    description:
      'Browse recent demo-request submissions from zeami.io.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['new', 'contacted', 'converted', 'archived', 'all'], description: 'Default new.' },
        limit: { type: 'number', minimum: 1, maximum: 100, description: 'Default 20.' },
      },
    },
    _meta: { access: 'read' },
  },
  {
    name: 'get_sales_lead',
    description:
      "Full context on one sales lead: form fields, Calendly booking (if any), converted-deal link.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Sales lead UUID' },
      },
      required: ['id'],
    },
    _meta: { access: 'read' },
  },
  {
    name: 'list_pending_board_decisions',
    description:
      "Every board decision currently awaiting votes. For each: deal name, gate, votes_required to proceed, votes_to_block, tally {proceed/stop/amend}, voters {name, vote}, and days_pending. Ideal for 'what's stuck at board' and 'who has/hasn't voted' questions.",
    inputSchema: { type: 'object', properties: {} },
    _meta: { access: 'read' },
  },
];

// ─── Write tools (still respect user's visibility scope) ─────────

const WRITE_TOOLS: McpToolDef[] = [
  {
    name: 'update_deal',
    description:
      'Persist changes to a deal: direct columns (name, company, contact, value, etc.), the fields JSONB blob, notes, verdict, gate. Non-admins can only update deals they created or lead.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string' },
        updates: {
          type: 'object',
          description: 'Fields to update. Can include: name, company, contact_name, contact_email, contact_phone, gate, score, risk, verdict, notes, value, currency, owner, lead_id, fields (JSONB merge), missing, flags.',
        },
      },
      required: ['deal_id', 'updates'],
    },
    _meta: { access: 'write', dispatches_to: 'exec_update_deal' },
  },
  {
    name: 'add_deal_note',
    description:
      'Append a note to a deal (adds to deal.notes with a timestamp header). Fastest way for Hermes to record brainstorming conclusions on a deal.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string' },
        note: { type: 'string', description: 'The note content. Prefixed with "--- HERMES <ISO date> ---" in the stored note field so origin is clear.' },
      },
      required: ['deal_id', 'note'],
    },
    _meta: { access: 'write' },
  },
  {
    name: 'create_deal',
    description:
      'Create a new deal at G1. The deal is owned by the calling user (user_id + lead_id set to the token owner).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        company: { type: 'string' },
        deal_type: { type: 'string', enum: ['sales', 'grant'] },
        contact_name: { type: 'string' },
        contact_email: { type: 'string' },
        value: { type: 'number' },
        currency: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['name', 'company', 'deal_type'],
    },
    _meta: { access: 'write' },
  },
  {
    name: 'mark_deal_lost',
    description:
      'Mark a deal as lost AND capture the structured lesson (reason, root_cause, competitor, lesson-for-next-time). Same atomic operation as the "Mark as Lost" button in the UI.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string' },
        reason: { type: 'string' },
        root_cause: { type: 'string', enum: ['price', 'timeline', 'fit', 'decision_maker', 'capability', 'competition', 'budget', 'eligibility', 'other'] },
        competitor: { type: 'string' },
        lesson: { type: 'string' },
      },
      required: ['deal_id', 'reason', 'root_cause', 'lesson'],
    },
    _meta: { access: 'write', dispatches_to: 'exec_mark_deal_lost' },
  },
  {
    name: 'assess_deal',
    description:
      'Score + risk + verdict for a deal. Persists to deals.score / risk / verdict and appends risk_signals to flags. Use after a substantive update to keep the assessment fresh.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string' },
        reasoning: { type: 'string' },
        score: { type: 'number', minimum: 0, maximum: 100 },
        risk: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        verdict: { type: 'string', enum: ['STRONG', 'PROCEED_WITH_CAUTION', 'WEAK', 'WALK_AWAY', 'STRONG_FIT', 'WEAK_FIT', 'DO_NOT_PURSUE'] },
        risk_signals: { type: 'array', items: { type: 'string' } },
      },
      required: ['deal_id', 'reasoning', 'score', 'risk', 'verdict', 'risk_signals'],
    },
    _meta: { access: 'write', dispatches_to: 'exec_assess_deal' },
  },
  {
    name: 'schedule_followup',
    description:
      'Draft or schedule an email/reminder followup for a deal. If due_in_days > 0, it goes into the followup queue for cron sending. If 0, it fires immediately for send_email path.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string' },
        type: { type: 'string', enum: ['email', 'reminder', 'sla_alert'] },
        subject: { type: 'string' },
        body: { type: 'string' },
        to_email: { type: 'string' },
        due_in_days: { type: 'number', minimum: 0 },
      },
      required: ['deal_id', 'type', 'body', 'due_in_days'],
    },
    _meta: { access: 'write', dispatches_to: 'exec_schedule_followup' },
  },
  {
    name: 'remember',
    description:
      'Persist a durable cross-conversation lesson. Scope="org" for team-wide facts, scope="user" for personal preferences of the token owner.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['org', 'user'] },
        fact: { type: 'string', maxLength: 500 },
      },
      required: ['scope', 'fact'],
    },
    _meta: { access: 'write', dispatches_to: 'exec_remember' },
  },
  {
    name: 'forget',
    description:
      'Remove a memory by its short id (e.g. "mem_a1b2").',
    inputSchema: {
      type: 'object',
      properties: {
        mem_id: { type: 'string' },
      },
      required: ['mem_id'],
    },
    _meta: { access: 'write', dispatches_to: 'exec_forget' },
  },
];

// ─── Additional write tools (deal-scoped side effects) ────────────
// Previously "admin-only" but the visibility scope (creator OR lead on
// the deal) is a sufficient guard — same rule the web UI enforces.
// Rate limits stay tight to prevent runaway loops (see auth.ts).

const SIDE_EFFECT_TOOLS: McpToolDef[] = [
  {
    name: 'send_telegram',
    description:
      'Send a board-review request to the Telegram executive group for a deal you own or lead. Rate-limited to 10 per rolling minute per token.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string' },
        message: { type: 'string' },
        gate: { type: 'number' },
      },
      required: ['deal_id', 'message', 'gate'],
    },
    _meta: { access: 'write', dispatches_to: 'exec_send_telegram' },
  },
  {
    name: 'send_email',
    description:
      'Send an email now via Resend, or draft as a followup, for a deal you own or lead. Rate-limited to 20 per rolling minute per token.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string' },
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        send_immediately: { type: 'boolean' },
      },
      required: ['deal_id', 'to', 'subject', 'body', 'send_immediately'],
    },
    _meta: { access: 'write', dispatches_to: 'exec_send_email' },
  },
  {
    name: 'advance_gate',
    description:
      'Advance a deal to a specific gate. Convenience wrapper around update_deal with only the gate change. Applies the same gate-advance guards (grant money-field check, missing fields, gate_events audit). Non-admins can advance their own deals — same as the web UI.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string' },
        new_gate: { type: 'number', minimum: 1, maximum: 10 },
        reason: { type: 'string' },
      },
      required: ['deal_id', 'new_gate'],
    },
    _meta: { access: 'write' },
  },
  {
    name: 'delete_deal',
    description:
      'Soft-delete a deal — hides it everywhere. Reversible via restore_deal (admin only). Same permission as the web UI: creator, lead, or admin.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string' },
      },
      required: ['deal_id'],
    },
    _meta: { access: 'write' },
  },
  {
    name: 'restore_deal',
    description:
      'Restore a previously soft-deleted deal. Admin only.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string' },
      },
      required: ['deal_id'],
    },
    _meta: { access: 'admin' },
  },
  {
    name: 'convert_lead_to_deal',
    description:
      "Turn a sales_leads row into a G1 sales deal. Same atomic operation as the /sales-leads Convert button.",
    inputSchema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string' },
      },
      required: ['lead_id'],
    },
    _meta: { access: 'write' },
  },
  {
    name: 'nudge_pending_votes',
    description:
      "Post a fresh reminder in the board Telegram group for pending decisions — includes current tally, votes still needed, and voting instructions. Replies to the new message become the vote anchor. Omit deal_id to nudge every pending decision. Admin-only because it posts to the shared board group. Bypasses the 4h throttle since a human is explicitly asking.",
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'Optional — nudge only this deal.' },
      },
    },
    _meta: { access: 'admin' },
  },
];

export const MCP_TOOLS: McpToolDef[] = [...READ_TOOLS, ...WRITE_TOOLS, ...SIDE_EFFECT_TOOLS];

export const TOOL_BY_NAME: Map<string, McpToolDef> = new Map(
  MCP_TOOLS.map((t) => [t.name, t] as const),
);
