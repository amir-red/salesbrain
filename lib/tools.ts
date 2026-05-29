import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { PROSPECT_TOOLS } from './prospect-tools';

const DEAL_TOOLS: Tool[] = [
  {
    name: 'assess_deal',
    description:
      'Analyze the current deal and produce a score (0-100), risk level, verdict, and risk signals. Updates the deal record in DB.',
    input_schema: {
      type: 'object' as const,
      properties: {
        deal_id: { type: 'string', description: 'UUID of the deal to assess' },
        reasoning: {
          type: 'string',
          description: 'Your reasoning for the assessment — factors considered, red flags, strengths',
        },
        score: { type: 'number', minimum: 0, maximum: 100, description: 'Deal score 0-100' },
        risk: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Overall risk level',
        },
        verdict: {
          type: 'string',
          enum: ['STRONG', 'PROCEED_WITH_CAUTION', 'WEAK', 'WALK_AWAY'],
          description: 'Deal verdict',
        },
        risk_signals: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of specific risk signals identified',
        },
      },
      required: ['deal_id', 'reasoning', 'score', 'risk', 'verdict', 'risk_signals'],
    },
  },
  {
    name: 'send_telegram',
    description:
      'Send a board review request to the Telegram executive group for voting. Used at board gates (G3, G5). The system auto-formats the message with deal details, gate progress, and voting instructions. You provide a 3-4 sentence summary covering deal value, key risks, solution fit, and your recommendation. Requires 5/8 executives to vote proceed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        deal_id: { type: 'string', description: 'UUID of the deal' },
        message: { type: 'string', description: 'AI-generated 3-4 sentence summary of the deal for the board. Include key decision factors, risks, and your recommendation.' },
        gate: { type: 'number', description: 'Gate number this board review is for (3 or 5)' },
      },
      required: ['deal_id', 'message', 'gate'],
    },
  },
  {
    name: 'send_email',
    description:
      'Send or draft an email. If send_immediately is true, sends now via Resend. If false, saves as a draft followup.',
    input_schema: {
      type: 'object' as const,
      properties: {
        deal_id: { type: 'string', description: 'UUID of the deal' },
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body (plain text or HTML)' },
        send_immediately: {
          type: 'boolean',
          description: 'true = send now via Resend; false = save as draft in followups table',
        },
      },
      required: ['deal_id', 'to', 'subject', 'body', 'send_immediately'],
    },
  },
  {
    name: 'update_deal',
    description:
      'Update deal fields — gate, score, risk, fields (jsonb), missing array, flags array, notes, value, etc. Use this to advance gates, record data, or update status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        deal_id: { type: 'string', description: 'UUID of the deal to update' },
        updates: {
          type: 'object',
          description:
            'Key-value pairs to update. Supports: name, company, contact_name, contact_email, contact_phone, gate, score, risk, verdict, fields (merged into jsonb), missing, flags, notes, value, currency, owner',
          properties: {
            name: { type: 'string' },
            company: { type: 'string' },
            contact_name: { type: 'string' },
            contact_email: { type: 'string' },
            contact_phone: { type: 'string' },
            gate: { type: 'number' },
            score: { type: 'number' },
            risk: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            verdict: {
              type: 'string',
              enum: ['STRONG', 'PROCEED_WITH_CAUTION', 'WEAK', 'WALK_AWAY'],
            },
            fields: { type: 'object', description: 'Merged into existing fields jsonb' },
            missing: { type: 'array', items: { type: 'string' } },
            flags: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string' },
            value: { type: 'number' },
            currency: { type: 'string' },
            owner: { type: 'string' },
            lead_id: { type: 'string', description: 'UUID of the user to assign as project lead' },
          },
        },
      },
      required: ['deal_id', 'updates'],
    },
  },
  {
    name: 'schedule_followup',
    description:
      'Schedule a followup email or reminder for a deal. Calculates due_at from due_in_days.',
    input_schema: {
      type: 'object' as const,
      properties: {
        deal_id: { type: 'string', description: 'UUID of the deal' },
        type: {
          type: 'string',
          enum: ['email', 'reminder', 'sla_alert'],
          description: 'Type of followup',
        },
        subject: { type: 'string', description: 'Subject line (for emails)' },
        body: { type: 'string', description: 'Body content' },
        to_email: { type: 'string', description: 'Recipient email (for emails)' },
        due_in_days: { type: 'number', description: 'Number of days from now until followup is due' },
      },
      required: ['deal_id', 'type', 'body', 'due_in_days'],
    },
  },
  {
    name: 'draft_concept',
    description:
      'Generate a structured concept/proposal document for the deal. Returns: problem statement, proposed solution, pricing approach, differentiators, and risks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        deal_id: { type: 'string', description: 'UUID of the deal' },
        problem: { type: 'string', description: "Client's core problem statement" },
        solution: { type: 'string', description: 'Proposed solution summary' },
        pricing_approach: { type: 'string', description: 'Pricing model and range' },
        differentiators: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key differentiators vs competition',
        },
        risks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Known risks and mitigations',
        },
      },
      required: ['deal_id', 'problem', 'solution', 'pricing_approach', 'differentiators', 'risks'],
    },
  },
  {
    name: 'prep_meeting',
    description:
      'Generate a structured meeting preparation briefing for an upcoming client meeting, call, demo, or presentation. Loads full deal context and produces a comprehensive briefing with talking points, objection handling, and recommended asks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        deal_id: { type: 'string', description: 'UUID of the deal' },
        meeting_type: {
          type: 'string',
          enum: ['discovery_call', 'demo', 'negotiation', 'board_review', 'closing', 'general'],
          description: 'Type of meeting to prepare for',
        },
        attendees: { type: 'string', description: 'Who will attend (roles/names)' },
        focus_areas: { type: 'array', items: { type: 'string' }, description: 'Specific topics to address' },
      },
      required: ['deal_id', 'meeting_type'],
    },
  },
];

// ─── Deal lifecycle: lost + lesson capture ──────────────────────
// One tool that does two writes in a single transaction:
//   1) flips deals.status = 'lost'
//   2) inserts a structured row into lessons_learned
// The agent fills the structured fields from the user's natural-language
// "we lost this — they wanted cheaper" instead of forcing the user to
// click through a modal in chat.
const LOSS_TOOLS: Tool[] = [
  {
    name: 'mark_deal_lost',
    description:
      'Mark a deal as lost AND record the structured lesson learned in one atomic step. Call when the user says they lost a deal, got rejected, walked away with a real reason, or asks you to record a loss. NEVER use for deals the user is just frustrated about — only when the loss is final and the user wants it recorded. Captures: free-text reason (what happened), root_cause enum (price / timeline / fit / decision_maker / capability / competition / budget / eligibility / other), optional competitor name, and the lesson for next time. For grants, prefer "eligibility" when the donor\'s entity/geography/sector rules disqualified us before merits were assessed — distinct from "fit" which is about narrative/intervention mismatch.',
    input_schema: {
      type: 'object' as const,
      properties: {
        deal_id: { type: 'string', description: 'UUID of the deal' },
        reason: {
          type: 'string',
          maxLength: 4000,
          description: 'What happened. Concise narrative paragraph. Example: "Donor only funds registered NGOs in West Africa; we\'re a private company in East Africa. Hard eligibility no — they emailed a polite decline two weeks after submission."',
        },
        root_cause: {
          type: 'string',
          enum: ['price', 'timeline', 'fit', 'decision_maker', 'capability', 'competition', 'budget', 'eligibility', 'other'],
          description: 'Single category that best explains the loss.',
        },
        competitor: {
          type: 'string',
          description: 'Optional — who won / what they chose instead.',
        },
        lesson: {
          type: 'string',
          maxLength: 4000,
          description: 'The takeaway — what to do differently on the next similar deal. Concrete and actionable. Example: "Always check donor eligibility rules at G1 before any concept work; budget at least 30 minutes for an entity/geography compliance check."',
        },
      },
      required: ['deal_id', 'reason', 'root_cause', 'lesson'],
    },
  },
];

// ─── Memory tools (durable cross-conversation facts) ────────────
// `remember` appends a bullet to memory/org.md (team-wide) or
// memory/users/<localpart>.md (per-user). The bullet survives every
// future chat — it's loaded into the system prompt's dynamic section
// on every turn. `forget` removes a bullet by its short id.
const MEMORY_TOOLS: Tool[] = [
  {
    name: 'remember',
    description:
      'Save a durable lesson the agent should recall in future conversations across deals. Use when the user explicitly says "remember X" / "in the future, always Y", OR when a clear cross-deal lesson emerges that isn\'t deal-specific. Do NOT use for deal-specific facts (those belong in update_deal). Choose scope="org" for team-wide rules ("we always...", "the team should..."), scope="user" for the current user\'s personal preference ("I prefer...", "for me always..."). Returns a short mem id (e.g. mem_a1b2) the user can later reference with forget.',
    input_schema: {
      type: 'object' as const,
      properties: {
        scope: {
          type: 'string',
          enum: ['org', 'user'],
          description: 'org = team-wide lesson everyone sees. user = personal preference visible only to the current user.',
        },
        fact: {
          type: 'string',
          maxLength: 500,
          description: 'One concise sentence. Phrase as a universal rule, not a deal-specific note. E.g. "Never quote on-prem without a 20% security premium." (good) vs "For ChipChip, charge 20% extra" (bad — belongs in deal.notes).',
        },
      },
      required: ['scope', 'fact'],
    },
  },
  {
    name: 'forget',
    description:
      'Remove a memory by its short id (e.g. "mem_a1b2"). The id is shown bracketed in the system prompt and was returned by the matching remember call.',
    input_schema: {
      type: 'object' as const,
      properties: {
        mem_id: { type: 'string', description: 'Short id like mem_a1b2.' },
      },
      required: ['mem_id'],
    },
  },
];

// Union of deal tools + prospect tools + memory tools + loss tools.
// The agent sees them all.
export const TOOLS: Tool[] = [...DEAL_TOOLS, ...PROSPECT_TOOLS, ...MEMORY_TOOLS, ...LOSS_TOOLS];
