// Firms on a list (core migration 075) — client-safe types and import helpers. The kernel (commands/firms.py) owns the
// data; these mirror what crm_firm_list / crm_firm_get return.

export type FirmVerdict = 'go' | 'later' | 'out' | 'unknown';
export type FirmStatus = 'new' | 'researched' | 'people_found' | 'contacted' | 'replied' | 'meeting' | 'passed' | 'out';

export interface FirmResearchSummary {
  thesis: string | null; stages: string[]; sectors: string[]; geographies: string[];
  cheque_min: number | null; cheque_max: number | null; currency: string | null;
  last_fund: { name?: string; size?: number; currency?: string; year?: number } | null;
  actively_investing: string | null;
  recent_investments: { company: string; date?: string; round?: string }[];
  team_size: number;
}

export interface FirmRow {
  id: string; icp_profile_id: string; account_id: string; rank: number | null; priority: number | null;
  status: FirmStatus; eligibility: FirmVerdict; eligibility_reasons: string[]; eligibility_override: boolean;
  contact_email: string | null; contact_route: string | null; notes: string | null;
  research_requested_at: string | null; research_error: string | null; researched_at: string | null;
  people_found_at: string | null; people_requested_at: string | null; people_error: string | null; updated_at: string;
  firm: string; website: string | null; domain: string | null; hq_location: string | null;
  confidence: string | null; people: number; contacted: number;
  research: FirmResearchSummary | null;
}

export interface FirmBrief {
  stages?: string[]; round_size?: number; currency?: string; entity_country?: string;
  geographies?: string[]; sectors?: string[]; exclude_sectors?: string[]; min_fund_year?: number; pitch?: string;
}

export interface FirmAuto { on: boolean; working: boolean; held: string | null; needs_brief: boolean; to_research: number; to_find_people: number }

export interface FirmListPayload {
  icp_id: string; list: string; brief: FirmBrief; auto: FirmAuto;
  counts: { total: number; researched: number; queued: number; go: number; later: number; out: number; unknown: number; with_email: number; with_people: number; people_queued: number };
  firms: FirmRow[];
}

export interface TeamMember { name: string; title?: string; focus?: string; profile_url?: string; linkedin_url?: string; email?: string }
export interface FirmSource { url: string; title?: string; supports?: string }

export interface FirmDetail extends Omit<FirmRow, 'research' | 'people' | 'contacted'> {
  firm_name: string; list_name: string; brief: FirmBrief;
  research: {
    profile: Record<string, unknown> & {
      summary?: string; thesis?: string; stages?: string[]; sectors?: string[]; geographies?: string[];
      cheque_min?: number; cheque_max?: number; currency?: string; hq_location?: string;
      last_fund?: { name?: string; size?: number; currency?: string; year?: number } | null;
      actively_investing?: string; actively_investing_why?: string;
      recent_investments?: { company: string; date?: string; round?: string }[];
      team?: TeamMember[]; contact?: { pitch_email?: string; general_email?: string; submission_url?: string };
      how_to_pitch?: string; hook?: string;
    };
    sources: FirmSource[]; confidence: string | null; model: string | null; researched_at: string;
  } | null;
  people: { id: string; stage: string; full_name: string | null; title: string | null; email: string | null;
            linkedin_public_id: string | null; last_contacted_at: string | null; source_type: string | null }[];
}

export const VERDICT_STYLE: Record<FirmVerdict, { label: string; color: string; hint: string }> = {
  go: { label: 'Go', color: 'var(--green)', hint: 'Fits the brief: stage, geography and thesis match' },
  later: { label: 'Check', color: 'var(--orange)', hint: 'Something is unconfirmed or a soft mismatch; read the reasons' },
  out: { label: 'Out', color: 'var(--red)', hint: 'Does not fit the brief (stage, cheque, not investing, …)' },
  unknown: { label: 'Not researched', color: 'var(--text-muted)', hint: 'No research yet' },
};

export const STATUS_LABEL: Record<FirmStatus, string> = {
  new: 'New', researched: 'Researched', people_found: 'People found', contacted: 'Contacted', replied: 'Replied',
  meeting: 'Meeting', passed: 'Passed', out: 'Out',
};

export function money(n: number | null | undefined, currency?: string | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sym = { EUR: '€', USD: '$', GBP: '£' }[(currency || 'USD').toUpperCase()] ?? `${currency} `;
  if (n >= 1e9) return `${sym}${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1e6) return `${sym}${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${sym}${Math.round(n / 1e3)}k`;
  return `${sym}${n}`;
}

export function chequeRange(r: { cheque_min?: number | null; cheque_max?: number | null; currency?: string | null } | null): string {
  if (!r || (r.cheque_min == null && r.cheque_max == null)) return '—';
  if (r.cheque_min != null && r.cheque_max != null) return `${money(r.cheque_min, r.currency)}–${money(r.cheque_max, r.currency)}`;
  return r.cheque_min != null ? `from ${money(r.cheque_min, r.currency)}` : `up to ${money(r.cheque_max, r.currency)}`;
}

// --- import -------------------------------------------------------------------------------------------------------

export type FirmImportField = 'firm' | 'website' | 'rank' | 'priority' | 'contact_email' | 'contact_route' | 'location' | 'notes';

export const FIRM_IMPORT_FIELDS: { key: FirmImportField; label: string }[] = [
  { key: 'firm', label: 'Firm name' }, { key: 'website', label: 'Website' }, { key: 'rank', label: 'Rank' },
  { key: 'priority', label: 'Priority (1–10)' }, { key: 'contact_email', label: 'Contact email' },
  { key: 'contact_route', label: 'Pitch form / route URL' }, { key: 'location', label: 'Location' },
  { key: 'notes', label: 'Notes' },
];

const FIRM_GUESSES: [RegExp, FirmImportField][] = [
  [/^(firm|company|investor|fund|organi[sz]ation|firma|unternehmen|name|normalized firm( \/ vehicle)?)$/, 'firm'],
  [/^(website|web|url|homepage|domain|webseite|research source)$/, 'website'],
  [/^(rank|#|order|position)$/, 'rank'],
  [/^(priority|prio|priorität)$/, 'priority'],
  [/^(e-?mail|contact email|pitch email)$/, 'contact_email'],
  [/^(contact route|route|contact \/ submission|submission|pitch form)$/, 'contact_route'],
  [/^(location|hq|city|country|geography|region)$/, 'location'],
  [/^(notes?|comments?|why zeami|notiz(en)?)$/, 'notes'],
];

export function guessFirmField(header: string): FirmImportField | '' {
  const h = header.trim().toLowerCase().replace(/[_*:]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, f] of FIRM_GUESSES) if (re.test(h)) return f;
  return '';
}

export type FirmImportRow = Partial<Record<FirmImportField, string>>;

export function mapFirmRows(rows: string[][], mapping: (FirmImportField | '')[]): FirmImportRow[] {
  const out: FirmImportRow[] = [];
  for (const r of rows) {
    const o: FirmImportRow = {};
    mapping.forEach((f, i) => {
      const v = (r[i] ?? '').toString().trim();
      if (!f || !v) return;
      o[f] = o[f] ? `${o[f]} ${v}` : v;
    });
    if (o.firm) out.push(o);
  }
  return out;
}

export interface FirmImportResult { row: number; status: 'new' | 'created' | 'duplicate' | 'error'; firm?: string; reason?: string; firm_id?: string }
export interface FirmImportSummary { dry_run: boolean; rows: number; new: number; created: number; duplicate: number; error: number; results: FirmImportResult[] }

export interface FirmProgressRun { started_at: string; finished_at: string | null; status: string; researched: number;
  people_added: number; summary: string | null; error: string | null }
export interface FirmProgressPayload {
  icp_id: string;
  auto: { on: boolean; working: boolean; held: string | null; needs_brief: boolean };
  counts: { total: number; researched: number; failed: number; to_research: number; go: number; later: number; out: number;
    go_with_people: number; go_nobody_found: number; to_find_people: number; people: number; with_email: number; with_linkedin: number };
  per_run: number; eta_minutes: number | null; next_batch_at: string | null;
  running: { started_at: string; firms: string[] } | null;
  runs: FirmProgressRun[]; blockers: string[]; notes: string[];
}
