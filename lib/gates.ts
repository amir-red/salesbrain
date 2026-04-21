export interface Gate {
  number: number;
  name: string;
  slaDays: number;
  isBoard: boolean;
  requiredFields?: string[];
  objective?: string;
}

export type DealType = 'sales' | 'grant';

// ─── Sales Pipeline (Mate deals) ────────────────────────────────

export const SALES_GATES: Gate[] = [
  { number: 1, name: 'Lead Qualification', slaDays: 3, isBoard: false },
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
  },
  { number: 3, name: 'Review Board 1', slaDays: 5, isBoard: true },
  { number: 4, name: 'Offer Strategy', slaDays: 14, isBoard: false },
  { number: 5, name: 'Review Board 2', slaDays: 5, isBoard: true },
  { number: 6, name: 'Offer Presentation', slaDays: 7, isBoard: false },
  { number: 7, name: 'Negotiation', slaDays: 21, isBoard: false },
  { number: 8, name: 'Close', slaDays: 3, isBoard: false },
  { number: 9, name: 'Project Handover', slaDays: 5, isBoard: false },
];

// ─── Grant Pipeline (ChipChip donor/funding deals) ──────────────

export const GRANT_GATES: Gate[] = [
  {
    number: 1,
    name: 'Opportunity Capture',
    slaDays: 2,
    isBoard: false,
    objective: 'Log the opportunity and prevent loss of inbound or discovered donor leads.',
    requiredFields: [
      'funding_body_name',
      'donor_type',
      'source_of_lead',
      'deadline_known',
      'funding_range_estimate',
    ],
  },
  {
    number: 2,
    name: 'Quick Triage',
    slaDays: 3,
    isBoard: false,
    objective: 'Kill obvious low-fit opportunities fast.',
    requiredFields: [
      'rough_eligibility_match',
      'rough_ticket_size_fit',
      'deadline_window',
      'initial_theme_match',
      'likely_entity_fit',
    ],
  },
  {
    number: 3,
    name: 'Strategic Fit Analysis',
    slaDays: 5,
    isBoard: false,
    objective: 'Score the opportunity against ChipChip strategy, capacity, and timing.',
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
    name: 'Partner and Approval Lock',
    slaDays: 7,
    isBoard: true,
    objective: 'Secure internal and external commitments before full submission.',
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
    requiredFields: [
      'baseline_locked',
      'milestone_plan',
      'reporting_calendar',
      'evidence_repository',
    ],
  },
];

// ─── Legacy export for backwards compatibility ──────────────────
// Existing code imports `GATES` and uses it as the sales pipeline.
export const GATES = SALES_GATES;

// ─── Pipeline selector ──────────────────────────────────────────

export function getPipeline(type: DealType | string | null | undefined): Gate[] {
  return type === 'grant' ? GRANT_GATES : SALES_GATES;
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
