import type { Tool } from '@anthropic-ai/sdk/resources/messages';

export const TOOLS: Tool[] = [
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
      'Send a message to the Telegram review board channel. Used for board gates (G3, G5) to request proceed/stop/amend decisions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        deal_id: { type: 'string', description: 'UUID of the deal' },
        message: { type: 'string', description: 'Message text to send to the board' },
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
];
