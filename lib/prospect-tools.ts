import type Anthropic from '@anthropic-ai/sdk';

/**
 * Agent tools for the Prospecting + Outreach layer.
 * These are layered on top of the existing deal-stage tools in lib/tools.ts.
 */
export const PROSPECT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_or_import_prospect',
    description:
      'Create or import a prospect. Resolves or creates the underlying account and contact, then creates a prospect record at stage P0_IMPORTED. Deduplicates on domain and email when possible. Use this to capture new inbound or outbound leads before enrichment.',
    input_schema: {
      type: 'object' as const,
      properties: {
        company_name: { type: 'string', description: 'Target company name' },
        domain: { type: 'string', description: 'Company domain (optional but preferred for dedup)' },
        full_name: { type: 'string', description: 'Contact full name' },
        email: { type: 'string', description: 'Contact email (optional)' },
        title: { type: 'string', description: 'Contact job title' },
        source_type: { type: 'string', description: 'e.g. referral, linkedin, event, inbound, manual' },
        source_detail: { type: 'string', description: 'Free-form context on where this lead came from' },
        campaign_id: { type: 'string', description: 'Optional campaign UUID' },
        notes: { type: 'string', description: 'Initial notes' },
      },
      required: ['company_name', 'full_name'],
    },
  },
  {
    name: 'enrich_prospect',
    description:
      'Enrich a prospect by filling known account and contact fields (industry, company_size, hq_location, seniority, persona_type) based on user-provided context. Advances stage to P1_ENRICHED.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string' },
        account_updates: { type: 'object', description: 'Fields to merge into account (industry, company_size, hq_location, geography, linkedin_url, subindustry)' },
        contact_updates: { type: 'object', description: 'Fields to merge into contact (seniority, department, persona_type, linkedin_url, phone)' },
      },
      required: ['prospect_id'],
    },
  },
  {
    name: 'score_prospect_fit',
    description:
      'Evaluate this prospect against our ICP (Mate-style sales) and return a structured score. Advances stage to P2_ICP_CHECKED. Considers: desktop-heavy knowledge work, process complexity, operational improvement need, automation readiness, stakeholder match, strategic relevance.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string' },
        score: { type: 'number', description: '0-100 ICP fit score' },
        verdict: { type: 'string', enum: ['strong_fit', 'proceed_with_caution', 'weak_fit', 'do_not_pursue'] },
        reason_codes: { type: 'array', items: { type: 'string' }, description: 'Short tags explaining the score e.g. desktop_heavy, has_ops_team, small_org' },
        disqualifiers: { type: 'array', items: { type: 'string' }, description: 'Hard blockers if any' },
        qualification_reason: { type: 'string', description: '2-3 sentence narrative' },
        criteria: { type: 'object', description: 'Structured per-criterion scores (optional)' },
      },
      required: ['prospect_id', 'score', 'verdict', 'qualification_reason'],
    },
  },
  {
    name: 'generate_research_brief',
    description:
      'Generate a concise, sales-usable research brief for this prospect: company context, likely pains, relevance to Mate, outreach angle, buyer hypothesis, risks/objections. Advances stage to P3_RESEARCH_READY.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string' },
        summary: { type: 'string', description: '2-4 sentence company context' },
        pain_hypotheses: { type: 'string', description: 'Likely operational pains' },
        why_now_signals: { type: 'string', description: 'Recent triggers or timing' },
        outreach_angle: { type: 'string', description: 'Recommended hook for first touch' },
        talking_points: { type: 'string', description: 'Bullet list of talking points' },
        risks: { type: 'string', description: 'Known objections or disqualifiers' },
      },
      required: ['prospect_id', 'summary', 'outreach_angle'],
    },
  },
  {
    name: 'draft_outreach_message',
    description:
      'Draft a short, credible outreach message. No hype, no exaggeration, no fake personalization. Sounds founder-led. Saved as an outreach_messages row with status=draft for human approval. Advances stage to P4_OUTREACH_DRAFTED.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string' },
        step_type: { type: 'string', enum: ['first_touch', 'follow_up_1', 'follow_up_2', 'breakup'] },
        subject: { type: 'string' },
        body: { type: 'string' },
        sequence_step_id: { type: 'string', description: 'Optional campaign step UUID' },
      },
      required: ['prospect_id', 'step_type', 'subject', 'body'],
    },
  },
  {
    name: 'approve_outreach_message',
    description: 'Mark an outreach draft as approved (status=approved). Called by a human or on explicit user instruction.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message_id: { type: 'string' },
      },
      required: ['message_id'],
    },
  },
  {
    name: 'schedule_outreach_step',
    description: 'Schedule an approved outreach message to be sent at a future time (status=scheduled, scheduled_for set).',
    input_schema: {
      type: 'object' as const,
      properties: {
        message_id: { type: 'string' },
        send_in_hours: { type: 'number', description: 'Hours from now. 0 = send immediately.' },
      },
      required: ['message_id', 'send_in_hours'],
    },
  },
  {
    name: 'send_outreach_message',
    description: 'Send an approved/scheduled outreach message immediately via Resend. Records sent_at, advances prospect to P5_SENT and sets last_contacted_at. Respects suppression list.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message_id: { type: 'string' },
      },
      required: ['message_id'],
    },
  },
  {
    name: 'classify_outreach_reply',
    description:
      'Classify an inbound reply from a prospect. Records an inbound outreach_messages row, advances stage to P6_REPLIED, and sets reply_status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string' },
        reply_body: { type: 'string' },
        classification: { type: 'string', enum: ['interested', 'not_now', 'wrong_person', 'objection', 'unsubscribe', 'no_fit', 'meeting_ready'] },
        objection_summary: { type: 'string' },
        next_action_recommendation: { type: 'string' },
        should_convert_to_deal: { type: 'boolean' },
      },
      required: ['prospect_id', 'reply_body', 'classification'],
    },
  },
  {
    name: 'recommend_prospect_next_step',
    description: 'Recommend the next step for a prospect. Writes a prospect_events row. Does NOT change stage.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string' },
        recommendation: { type: 'string' },
        next_action_at: { type: 'string', description: 'ISO timestamp for when this should happen' },
      },
      required: ['prospect_id', 'recommendation'],
    },
  },
  {
    name: 'convert_prospect_to_deal',
    description:
      'Qualify a prospect and convert it into a normal SalesBrain sales deal at G1. Carries over research summary, outreach history, and links the new deal back to the prospect. Advances stage to P7_QUALIFIED.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string' },
        deal_name: { type: 'string', description: 'Name for the new deal (defaults to account+contact)' },
        initial_value: { type: 'number', description: 'Estimated deal value (optional)' },
        currency: { type: 'string', description: 'Default USD' },
      },
      required: ['prospect_id'],
    },
  },
  {
    name: 'archive_prospect',
    description: 'Archive a prospect with a reason. Advances stage to P8_DISQUALIFIED or P9_ARCHIVED.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string' },
        reason: { type: 'string' },
        disqualified: { type: 'boolean', description: 'True = P8_DISQUALIFIED, False = P9_ARCHIVED' },
      },
      required: ['prospect_id', 'reason'],
    },
  },
  {
    name: 'analyze_communication_style',
    description:
      'Read the imported messages (Gmail / WhatsApp / LinkedIn / pasted) for a contact and produce a structured communication profile: relationship type, formality, typical length, tone, greeting style, sign-off, quirks, and sample openers. Stores the profile on contacts.communication_profile. Use this before drafting outreach so draft_outreach_message can match the user\'s real tone with that specific person.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contact_id: { type: 'string', description: 'UUID of the contact' },
      },
      required: ['contact_id'],
    },
  },
  {
    name: 'research_company_from_url',
    description:
      'Fetch the given company website, read the homepage + about page, and produce a structured company research profile: what they do, size signals, likely pains, buyer hypothesis, outreach angle, and risks. Updates the account record with inferred fields (industry, company_size when visible) and attaches a research brief if a prospect_id is provided. Use this for every cold prospect before drafting outreach.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'UUID of the account' },
        website: { type: 'string', description: 'URL to research (e.g. https://acme.com)' },
        prospect_id: { type: 'string', description: 'Optional — attach the research brief to this prospect too' },
      },
      required: ['account_id', 'website'],
    },
  },
];
