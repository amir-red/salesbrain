/**
 * Prospecting + Outreach layer for SalesBrain.
 *
 * Sits BEFORE the existing sales pipeline. A prospect moves through P0-P9
 * stages; once qualified (P7), it's converted into a normal sales deal at G1.
 */

export type ProspectStage =
  | 'P0_IMPORTED'
  | 'P1_ENRICHED'
  | 'P2_ICP_CHECKED'
  | 'P3_RESEARCH_READY'
  | 'P4_OUTREACH_DRAFTED'
  | 'P5_SENT'
  | 'P6_REPLIED'
  | 'P7_QUALIFIED'
  | 'P8_DISQUALIFIED'
  | 'P9_ARCHIVED';

export interface ProspectStageSpec {
  stage: ProspectStage;
  label: string;
  description: string;
  order: number;
  isTerminal: boolean;
}

export const PROSPECT_STAGES: ProspectStageSpec[] = [
  { stage: 'P0_IMPORTED', label: 'Imported', description: 'Just captured, no enrichment yet', order: 0, isTerminal: false },
  { stage: 'P1_ENRICHED', label: 'Enriched', description: 'Basic account and contact data populated', order: 1, isTerminal: false },
  { stage: 'P2_ICP_CHECKED', label: 'ICP Checked', description: 'Fit against ICP scored', order: 2, isTerminal: false },
  { stage: 'P3_RESEARCH_READY', label: 'Research Ready', description: 'Sales-usable research brief generated', order: 3, isTerminal: false },
  { stage: 'P4_OUTREACH_DRAFTED', label: 'Outreach Drafted', description: 'AI drafts waiting for approval', order: 4, isTerminal: false },
  { stage: 'P5_SENT', label: 'Sent', description: 'At least one outreach message delivered', order: 5, isTerminal: false },
  { stage: 'P6_REPLIED', label: 'Replied', description: 'Inbound response received', order: 6, isTerminal: false },
  { stage: 'P7_QUALIFIED', label: 'Qualified', description: 'Ready to convert to deal', order: 7, isTerminal: false },
  { stage: 'P8_DISQUALIFIED', label: 'Disqualified', description: 'Not a fit — archive', order: 8, isTerminal: true },
  { stage: 'P9_ARCHIVED', label: 'Archived', description: 'No longer active', order: 9, isTerminal: true },
];

export function getProspectStage(stage: string): ProspectStageSpec | undefined {
  return PROSPECT_STAGES.find((s) => s.stage === stage);
}

export function isTerminalStage(stage: string): boolean {
  return getProspectStage(stage)?.isTerminal ?? false;
}

export function nextStage(stage: ProspectStage): ProspectStage | null {
  const current = getProspectStage(stage);
  if (!current || current.isTerminal) return null;
  const next = PROSPECT_STAGES.find((s) => s.order === current.order + 1);
  return next?.stage ?? null;
}

/**
 * Suggested fit labels based on ICP score (0-100).
 */
export function fitLabelFromScore(score: number | null): string {
  if (score === null) return 'unscored';
  if (score >= 75) return 'strong_fit';
  if (score >= 60) return 'proceed_with_caution';
  if (score >= 40) return 'weak_fit';
  return 'do_not_pursue';
}

/**
 * Domain normalization helper — strips www., protocol, trailing slash, lowercases.
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const cleaned = trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
  return cleaned || null;
}

/**
 * Company-name normalization for dedup: strips legal suffixes, collapses whitespace, lowercases.
 */
export function normalizeCompanyName(name: string | null | undefined): string | null {
  if (!name) return null;
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[,.]/g, '')
    .replace(/\b(inc|llc|ltd|plc|corp|corporation|gmbh|sa|sas|bv|ag)\b\.?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}
