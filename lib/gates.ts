export interface Gate {
  number: number;
  name: string;
  slaDays: number;
  isBoard: boolean;
  requiredFields?: string[];
  /** Long-form objective — used in the agent's system prompt context for grant gates. */
  objective?: string;
  /** Short human-readable description shown on hover in the pipeline kanban. */
  description?: string;
}

export type DealType = 'sales' | 'grant' | 'ai_credit';

// ─── Sales Pipeline (Zeami deals) ────────────────────────────────

export const SALES_GATES: Gate[] = [
  {
    number: 1,
    name: 'Lead Qualification',
    slaDays: 3,
    isBoard: false,
    description: 'Initial qualification — is this lead even worth pursuing? Capture company basics, contact, and source. Disqualify fast if there\'s no real signal.',
  },
  {
    number: 2,
    name: 'Demand Analysis',
    slaDays: 10,
    isBoard: false,
    requiredFields: [
      'economic_size',
      'solution_fit',
      'client_capability',
      'our_capability',
      'payment_terms',
      'sales_cycle',
      'pilot_or_full',
    ],
    description: 'Understand the customer\'s actual problem, budget, decision authority, and timeline. Score solution-fit. Decide pilot vs. full implementation.',
  },
  {
    number: 3,
    name: 'Review Board 1',
    slaDays: 5,
    isBoard: true,
    description: 'First executive checkpoint. The board reviews demand-analysis findings and votes proceed/stop. 5 of 8 votes required to advance. Deal is blocked until a decision lands.',
  },
  {
    number: 4,
    name: 'Offer Strategy',
    slaDays: 14,
    isBoard: false,
    description: 'Internal: design the offer, pricing, scope, and narrative. Pricing-calculator quote drafted here. Output: a complete offer ready for team review.',
  },
  // G5 was previously the second board gate. Internal Sign-off is now a
  // normal team-alignment step before client-facing G6 — the actual
  // executive review moved to G7 where there are real negotiated terms.
  {
    number: 5,
    name: 'Internal Sign-off',
    slaDays: 5,
    isBoard: false,
    description: 'Team agrees the offer is ready to present. Sales lead / PM reviews pricing, scope, and materials. No board vote — soft hygiene check before the offer leaves the building.',
  },
  {
    number: 6,
    name: 'Offer Presentation',
    slaDays: 7,
    isBoard: false,
    description: 'Present the offer to the client. Pricing, scope, deployment options, timeline. Capture client reactions and objections so the negotiation that follows starts informed.',
  },
  {
    number: 7,
    // Renamed from "Negotiation" → "Review Board 2" to match the G3
    // "Review Board 1" labelling convention. The description below still
    // explains the actual work (negotiate terms + lock deployment plan).
    name: 'Review Board 2',
    slaDays: 21,
    // Second sales board gate. The board reviews the negotiated terms
    // (pricing, payment, scope) AND the deployment plan locked at this
    // gate, so they're approving infrastructure choice + commercials in
    // one pass before Close (G8).
    isBoard: true,
    requiredFields: ['deployment_plan'],
    description: 'Negotiate final terms with the client. Lock the deployment plan (on-premise or SaaS cloud). Second board review: 5 of 8 vote on the negotiated deal + infrastructure choice before Close.',
  },
  {
    number: 8,
    name: 'Close',
    slaDays: 3,
    isBoard: false,
    description: 'Contract signed. Last paperwork (legal, procurement, payment terms confirmed). Short SLA — once the board approves G7, finalize fast or risk the deal cooling.',
  },
  {
    number: 9,
    name: 'Project Handover',
    slaDays: 5,
    isBoard: false,
    description: 'Won. Auto-creates the onboarding row at Stage 1, sends the welcome email to the client with the Stage-2 contacts form, fires the "DEAL WON" Telegram notification. Hand off to the delivery team.',
  },
];

// ─── Grant Pipeline (ChipChip donor/funding deals) ──────────────

export const GRANT_GATES: Gate[] = [
  {
    number: 1,
    name: 'Opportunity Capture & Money Sniff Test',
    slaDays: 2,
    isBoard: false,
    objective:
      'Log the opportunity AND establish money clarity before anything else. We must know amount, our contribution, and split before advancing.',
    description: 'Log the opportunity and lock down the money facts FIRST: grant min/max, our contribution (cash + in-kind), and the cofunding split. Hard-blocked from advancing until these are set — no more time-wasted on grants without budget clarity.',
    requiredFields: [
      'funding_body_name',
      'donor_type',
      'source_of_lead',
      'deadline_known',
      // Money-first fields (the priority):
      'grant_amount_min',         // USD minimum likely award
      'grant_amount_max',         // USD maximum likely award
      'our_contribution',         // USD WE need to put in (cash + in-kind)
      'our_contribution_type',    // none | cash | in_kind | mixed
      'cofunding_split',          // full_grant | 75_25 | 50_50 | 25_75 | other
    ],
  },
  {
    number: 2,
    name: 'Quick Triage & Pipeline Comparison',
    slaDays: 3,
    isBoard: false,
    objective:
      'Compare against other active grants. If this grant is small while bigger ones are open, de-prioritize. Force opportunity-cost thinking.',
    description: 'Triage: where does this grant rank vs other active opportunities by total value? Bottom-third grants get de-prioritized when bigger ones are open. Forces opportunity-cost discipline before investing real work.',
    requiredFields: [
      'rough_eligibility_match',
      'rough_ticket_size_fit',
      'deadline_window',
      'initial_theme_match',
      'likely_entity_fit',
      'pipeline_rank_decision',  // pursue | deprioritize | drop — the actual call after seeing pipeline
    ],
  },
  {
    number: 3,
    name: 'Strategic Fit + Early Board Review',
    slaDays: 5,
    isBoard: true,            // ← NEW: board gate moved to here for early commit
    objective:
      'Score the opportunity, present money + alignment + pipeline rank to the board, get an early go/no-go BEFORE investing weeks of relationship and concept work.',
    description: 'First board review — EARLY. The board sees money + a 100-pt strategic-alignment score + pipeline rank and votes proceed/stop BEFORE we invest weeks on relationships and drafts. 5 of 8 vote to proceed; ≥75 score = STRONG_FIT.',
    requiredFields: [
      'strategic_alignment_score',
      'narrative_fit',
      'beneficiary_fit',
      'public_benefit_logic',
      'commercial_logic',
      'team_capacity_assessment',
      'timeline_feasibility',
      'reporting_burden_estimate',
      'probability_of_success',
    ],
  },
  {
    number: 4,
    name: 'Relationship and Positioning',
    slaDays: 14,
    isBoard: false,
    objective: 'Improve win probability before full drafting.',
    description: 'Build the donor relationship before drafting. Map key contacts, set positioning, pick the target next step (intro call, problem-statement workshop, etc.). Improves win probability before you spend writing time.',
    requiredFields: [
      'relationship_owner',
      'key_contacts',
      'current_relationship_status',
      'positioning_hypothesis',
      'target_next_step',
    ],
  },
  {
    number: 5,
    name: 'Concept Note / Pilot Framing',
    slaDays: 7,
    isBoard: false,
    objective: 'Convert opportunity into a concrete intervention with outputs, KPIs, and partners.',
    description: 'Convert the abstract opportunity into a concrete intervention: title, problem statement, proposed intervention, outputs, outcomes, target beneficiaries, pilot scope, KPIs, partner roles. The artifact is the concept note we share with the donor.',
    requiredFields: [
      'concept_title',
      'problem_statement',
      'proposed_intervention',
      'outputs',
      'outcomes',
      'target_beneficiaries',
      'pilot_scope',
      'kpis',
      'partner_roles',
    ],
  },
  {
    number: 6,
    name: 'Budget and Implementation Design',
    slaDays: 10,
    isBoard: false,
    objective: 'Turn concept into an implementable, donor-compliant structure.',
    description: 'Turn the concept into something a donor can fund and we can deliver: detailed budget, cofunding source, workplan, staffing plan, reporting requirements, risk register. Donor-compliant structure.',
    requiredFields: [
      'budget_range',
      'detailed_budget',
      'cofunding_requirement',
      'cofunding_source',
      'implementation_workplan',
      'staffing_plan',
      'reporting_requirements',
      'risk_register',
    ],
  },
  {
    number: 7,
    // Renamed from "Partner and Approval Lock" → "Review Board 2" to match
    // the G3 "Review Board 1" labelling convention. The description still
    // explains the actual work (internal sign-off + partner confirmations
    // before producing the proposal pack).
    name: 'Review Board 2',
    slaDays: 7,
    isBoard: true,
    objective: 'Secure internal and external commitments before full submission.',
    description: 'Second board review. Internal sign-off + partner confirmations + legal-entity submission plan. Lock everyone in before we burn time producing the final proposal pack.',
    requiredFields: [
      'internal_signoff',
      'partner_confirmations',
      'legal_entity_submission_plan',
    ],
  },
  {
    number: 8,
    name: 'Proposal Production and Submission',
    slaDays: 14,
    isBoard: false,
    objective: 'Produce the final application pack and submit.',
    description: 'Produce the final application pack: narrative, budget, annexes, compliance checks. Submit via the donor\'s submission channel. After this, the ball is in the donor\'s court.',
    requiredFields: [
      'final_narrative',
      'final_budget',
      'annexes',
      'compliance_check_complete',
      'submission_channel',
    ],
  },
  {
    number: 9,
    name: 'Negotiation and Award Setup',
    slaDays: 21,
    isBoard: true,
    objective: 'Convert positive donor response into a workable award.',
    description: 'Third board review. Convert a positive donor response into a workable award: negotiate conditions, log feedback, assign a contract owner. Board approval before signing.',
    requiredFields: [
      'donor_feedback',
      'negotiation_log',
      'award_conditions',
      'contract_owner',
    ],
  },
  {
    number: 10,
    name: 'Implementation, Reporting, Closeout',
    slaDays: 365,
    isBoard: false,
    objective: 'Deliver the project, report credibly, and preserve institutional memory.',
    description: 'Deliver the project, report credibly, preserve institutional memory. Long-running (~12 months SLA). Baseline locked, milestone plan, reporting calendar, evidence repository for closeout.',
    requiredFields: [
      'baseline_locked',
      'milestone_plan',
      'reporting_calendar',
      'evidence_repository',
    ],
  },
];

// ─── AI credits (migration 031) ──────────────────────────────────
// Mirror of salesbrain-core.domain.gates.AI_CREDIT_GATES. 5 stages,
// no board reviews — small-ticket + fast-turn credit chase (Google,
// AWS, Anthropic, ElevenLabs, DigitalOcean). Post-award utilization
// tracked via grant_resources rows (resource_type='credits').
export const AI_CREDIT_GATES: Gate[] = [
  {
    number: 1,
    name: 'Discovered',
    slaDays: 14,
    isBoard: false,
    objective: 'Capture the opportunity and rough value.',
    description: 'Opportunity found. Log provider, program name, and rough potential value so we can prioritize against other credit applications in flight.',
    requiredFields: ['provider', 'credit_program_name', 'potential_value', 'potential_currency'],
  },
  {
    number: 2,
    name: 'Qualified',
    slaDays: 7,
    isBoard: false,
    objective: 'Confirm eligibility and pick applicant entity (ChipChip / Zeami / both).',
    description: 'Eligibility screening + applicant-entity choice per the KB decision tree.',
    requiredFields: ['eligibility_confirmed', 'applicant_entity', 'estimated_credit_value'],
  },
  {
    number: 3,
    name: 'Applied',
    slaDays: 30,
    isBoard: false,
    objective: 'Track submission so follow-ups fire on the right cadence.',
    description: 'Application submitted. Record URL + date so follow-up reminders are anchored.',
    requiredFields: ['application_url', 'application_date'],
  },
  {
    number: 4,
    name: 'Awarded',
    slaDays: 21,
    isBoard: false,
    objective: 'Convert the promise into a credit balance the CRM can monitor.',
    description: 'Approved — attach a grant_resources row (resource_type=credits) so balance, utilization, and expiry surface on /credits and daily reminders.',
    requiredFields: ['award_amount', 'credits_activated_at', 'expires_at'],
  },
  {
    number: 5,
    name: 'Active',
    slaDays: 365,
    isBoard: false,
    objective: 'Utilize credits fully before they expire.',
    description: 'Live credits — being used. Utilization tracked on the linked grant_resources row. Deal moves to won when fully utilized, or expired if the clock runs out first.',
    requiredFields: [],
  },
];

// ─── Legacy export for backwards compatibility ──────────────────
// Existing code imports `GATES` and uses it as the sales pipeline.
export const GATES = SALES_GATES;

/**
 * Money fields required at G1 for grant deals. Enforced cross-gate:
 * regardless of current gate, an existing grant missing any of these
 * is BLOCKED from advancing (lib/tool-executors.ts:exec_update_deal)
 * and the AI is told to ask for them at the top of every prompt.
 */
export const GRANT_MONEY_FIELDS = [
  'grant_amount_min',
  'grant_amount_max',
  'our_contribution',
  'our_contribution_type',
  'cofunding_split',
];

// ─── Pipeline selector ──────────────────────────────────────────

export function getPipeline(type: DealType | string | null | undefined): Gate[] {
  if (type === 'grant') return GRANT_GATES;
  if (type === 'ai_credit') return AI_CREDIT_GATES;
  return SALES_GATES;
}

export function getGate(number: number, type: DealType | string = 'sales'): Gate | undefined {
  return getPipeline(type).find((g) => g.number === number);
}

export function getMissingFields(gate: number, fields: Record<string, unknown>, type: DealType | string = 'sales'): string[] {
  const g = getGate(gate, type);
  if (!g?.requiredFields) return [];
  return g.requiredFields.filter((f) => {
    const val = fields[f];
    return val === undefined || val === null || val === '';
  });
}

export type SLAStatus = 'ok' | 'warning' | 'breached';

export function getSLAStatus(
  gate: number,
  gateEnteredAt: Date,
  type: DealType | string = 'sales'
): { status: SLAStatus; daysInGate: number; slaDays: number } {
  const g = getGate(gate, type);
  if (!g) return { status: 'ok', daysInGate: 0, slaDays: 0 };

  const now = new Date();
  const msInDay = 86400000;
  const daysInGate = Math.floor((now.getTime() - gateEnteredAt.getTime()) / msInDay);
  const slaDays = g.slaDays;

  let status: SLAStatus = 'ok';
  if (daysInGate >= slaDays) {
    status = 'breached';
  } else if (daysInGate >= slaDays * 0.75) {
    status = 'warning';
  }

  return { status, daysInGate, slaDays };
}
