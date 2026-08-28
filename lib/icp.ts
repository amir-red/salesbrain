/**
 * ICP (ideal-customer profile) — the builder's vocabulary and the bridge
 * between the two JSON columns on `icp_profiles`:
 *
 *   criteria  — what makes a person a FIT (consumed by the Python scorer,
 *               salesbrain-core policy/icp.py; keys mirrored here exactly)
 *   filters   — what we ASK Sales Navigator for (plain words; the ring
 *               resolves them to LinkedIn ids in tools/prospecting.py)
 *
 * One set of chip selections produces both, via `buildSalesNavFilters`, so a
 * profile can never target one audience and score another.
 *
 * Client-safe: no DB, no server imports.
 */

export type SeniorityBand = 'c_level' | 'founder' | 'vp' | 'head' | 'director' | 'manager' | 'senior';
export type WeightKey = 'title' | 'seniority' | 'location' | 'industry' | 'size' | 'network';

export interface IcpCriteria {
  titles: string[];
  seniority: SeniorityBand[];
  locations: string[];
  industries: string[];
  company_sizes: string[];
  exclude_titles: string[];
  exclude_companies: string[];
  weights: Record<WeightKey, number>;
}

export interface IcpProfile {
  id: string;
  name: string;
  product: string | null;
  description: string | null;
  search_keywords: string | null;
  filters: Record<string, unknown>;
  criteria: IcpCriteria;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  prospects?: number;
}

// Mirrors policy/icp.py DEFAULT_WEIGHTS. `size` defaults to 0 so profiles that
// predate the builder keep their exact scores; the builder raises it when the
// user picks company sizes.
export const DEFAULT_WEIGHTS: Record<WeightKey, number> = {
  title: 40, seniority: 20, location: 20, industry: 15, size: 0, network: 5,
};

export const WEIGHT_LABELS: { key: WeightKey; label: string; hint: string }[] = [
  { key: 'title', label: 'Job title', hint: 'Title matches one of the target roles' },
  { key: 'seniority', label: 'Seniority', hint: 'Title sits in a target seniority band' },
  { key: 'location', label: 'Location', hint: 'Person is in a target market' },
  { key: 'industry', label: 'Industry', hint: 'Company is in a target industry' },
  { key: 'size', label: 'Company size', hint: 'Headcount is in a target bucket' },
  { key: 'network', label: 'Warmth', hint: '1st/2nd-degree LinkedIn connection' },
];

export const SENIORITY_BANDS: { key: SeniorityBand; label: string; hint: string }[] = [
  { key: 'c_level', label: 'C-level', hint: 'CEO, COO, CFO, CTO…' },
  { key: 'founder', label: 'Founder / Owner', hint: 'Founder, co-founder, owner' },
  { key: 'vp', label: 'VP', hint: 'VP, SVP, EVP' },
  { key: 'head', label: 'Head of', hint: '"Head of X"' },
  { key: 'director', label: 'Director', hint: 'Director, MD' },
  { key: 'manager', label: 'Manager', hint: 'Manager, lead, principal' },
  { key: 'senior', label: 'Senior IC', hint: 'Senior / staff individual contributor' },
];

/**
 * Role presets, grouped the way a buyer map is drawn. `fn` is the LinkedIn
 * DEPARTMENT the group maps to for the Sales Navigator `function` filter;
 * groups without one (executives, founders) are reached via title keywords.
 */
export const ROLE_GROUPS: { group: string; fn?: string; titles: string[] }[] = [
  { group: 'Executive', titles: ['Chief Executive Officer', 'Chief Operating Officer', 'Chief Financial Officer', 'Chief Technology Officer', 'Chief Information Officer', 'Chief Product Officer', 'Chief Revenue Officer', 'Managing Director', 'General Manager'] },
  { group: 'Founders & owners', titles: ['Founder', 'Co-Founder', 'Owner', 'Managing Partner', 'Partner'] },
  { group: 'Operations', fn: 'Operations', titles: ['Head of Operations', 'VP Operations', 'Director of Operations', 'Operations Manager', 'Head of Business Operations', 'Chief of Staff', 'Head of Transformation', 'Process Improvement Manager'] },
  { group: 'Finance', fn: 'Finance', titles: ['VP Finance', 'Finance Director', 'Head of Finance', 'Financial Controller', 'Head of FP&A'] },
  { group: 'Technology', fn: 'Engineering', titles: ['VP Engineering', 'Head of Engineering', 'Head of Platform', 'Director of Engineering', 'Head of IT', 'IT Director', 'Head of Data', 'Head of Automation'] },
  { group: 'Product & data', fn: 'Product Management', titles: ['VP Product', 'Head of Product', 'Director of Product', 'Head of Analytics', 'Chief Data Officer'] },
  { group: 'Sales & growth', fn: 'Sales', titles: ['VP Sales', 'Head of Sales', 'Head of Growth', 'Head of Business Development', 'Commercial Director'] },
  { group: 'People', fn: 'Human Resources', titles: ['Chief People Officer', 'VP People', 'Head of HR', 'HR Director'] },
  { group: 'Programs & grants', titles: ['Program Director', 'Program Manager', 'Head of Partnerships', 'Grants Manager', 'Country Director', 'Head of Impact'] },
];

/** LinkedIn-ish industry vocabulary. Free text is allowed too. */
export const INDUSTRIES: string[] = [
  'Software Development', 'IT Services and IT Consulting', 'Financial Services', 'Banking', 'Insurance',
  'Investment Management', 'Venture Capital and Private Equity', 'Manufacturing', 'Retail', 'E-commerce',
  'Consumer Goods', 'Food and Beverage', 'Agriculture', 'Logistics and Supply Chain', 'Transportation',
  'Telecommunications', 'Business Consulting and Services', 'Professional Services', 'Accounting', 'Legal Services',
  'Staffing and Recruiting', 'Marketing and Advertising', 'Media and Entertainment', 'Hospitality', 'Travel',
  'Real Estate', 'Construction', 'Energy', 'Utilities', 'Oil and Gas', 'Mining', 'Automotive',
  'Healthcare', 'Hospitals and Health Care', 'Pharmaceuticals', 'Biotechnology', 'Medical Devices',
  'Education', 'Higher Education', 'Non-profit Organizations', 'International Development', 'Government Administration',
  'Defense and Space', 'Aviation and Aerospace', 'Environmental Services', 'Fintech', 'Outsourcing and Offshoring',
];

export const LOCATION_GROUPS: { group: string; items: string[] }[] = [
  { group: 'Regions', items: ['Europe', 'North America', 'Middle East', 'Africa', 'Asia-Pacific', 'Latin America', 'Nordics', 'DACH', 'Benelux', 'European Union'] },
  { group: 'Europe', items: ['United Kingdom', 'Germany', 'France', 'Netherlands', 'Spain', 'Italy', 'Switzerland', 'Austria', 'Belgium', 'Sweden', 'Denmark', 'Norway', 'Finland', 'Ireland', 'Poland', 'Portugal'] },
  { group: 'North America', items: ['United States', 'Canada'] },
  { group: 'Middle East & Africa', items: ['United Arab Emirates', 'Saudi Arabia', 'Israel', 'Ethiopia', 'Kenya', 'Nigeria', 'South Africa', 'Egypt', 'Rwanda', 'Ghana'] },
  { group: 'Asia-Pacific', items: ['Singapore', 'India', 'Australia', 'Japan'] },
];

// LinkedIn's headcount ladder. Keys are what policy/icp.py SIZE_BUCKETS stores.
export const COMPANY_SIZES: { key: string; label: string; min: number; max: number | null }[] = [
  { key: '1-10', label: '1–10', min: 1, max: 10 },
  { key: '11-50', label: '11–50', min: 11, max: 50 },
  { key: '51-200', label: '51–200', min: 51, max: 200 },
  { key: '201-500', label: '201–500', min: 201, max: 500 },
  { key: '501-1000', label: '501–1,000', min: 501, max: 1000 },
  { key: '1001-5000', label: '1,001–5,000', min: 1001, max: 5000 },
  { key: '5001-10000', label: '5,001–10,000', min: 5001, max: 10000 },
  { key: '10001+', label: '10,001+', min: 10001, max: null },
];

/** Title fragments that mean "not a buyer" — the Gojiberry "who should we exclude" step. */
export const EXCLUDE_TITLE_PRESETS: string[] = [
  'intern', 'student', 'open to work', 'seeking opportunities', 'looking for', 'freelance',
  'freelancer', 'consultant', 'recruiter', 'talent acquisition', 'retired', 'assistant', 'coach',
];

export const PRODUCTS: { key: string; label: string }[] = [
  { key: 'zeami', label: 'Zeami' },
  { key: 'chipchip', label: 'ChipChip' },
];

export function emptyCriteria(): IcpCriteria {
  return {
    titles: [], seniority: [], locations: [], industries: [], company_sizes: [],
    exclude_titles: [], exclude_companies: [], weights: { ...DEFAULT_WEIGHTS },
  };
}

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

/** Tolerant load from the JSONB column — older rows lack some keys. */
export function normalizeCriteria(raw: unknown): IcpCriteria {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const w = (r.weights && typeof r.weights === 'object' ? r.weights : {}) as Record<string, unknown>;
  const weights = { ...DEFAULT_WEIGHTS };
  for (const k of Object.keys(weights) as WeightKey[]) {
    const n = Number(w[k]);
    if (Number.isFinite(n) && n >= 0) weights[k] = Math.round(n);
  }
  const bands = new Set(SENIORITY_BANDS.map((b) => b.key));
  return {
    titles: strList(r.titles),
    seniority: strList(r.seniority).filter((s): s is SeniorityBand => bands.has(s as SeniorityBand)),
    locations: strList(r.locations),
    industries: strList(r.industries),
    company_sizes: strList(r.company_sizes),
    exclude_titles: strList(r.exclude_titles),
    exclude_companies: strList(r.exclude_companies),
    weights,
  };
}

export function weightsTotal(w: Record<WeightKey, number>): number {
  return Object.values(w).reduce((a, b) => a + (Number(b) || 0), 0);
}

/**
 * Rescale weights so they sum to 100, keeping their proportions. Zero-weight
 * keys stay zero. Rounding drift is absorbed by the largest weight so the
 * total is exactly 100.
 */
export function normalizeWeights(w: Record<WeightKey, number>): Record<WeightKey, number> {
  const total = weightsTotal(w);
  if (total === 0) return { ...DEFAULT_WEIGHTS };
  const out = { ...w };
  let acc = 0;
  let maxKey: WeightKey = 'title';
  for (const k of Object.keys(out) as WeightKey[]) {
    out[k] = Math.round((out[k] / total) * 100);
    acc += out[k];
    if (out[k] > out[maxKey]) maxKey = k;
  }
  out[maxKey] += 100 - acc;
  return out;
}

// Our scorer bands → Sales Navigator's fixed seniority vocabulary
// (salesbrain_hermes.unipile.SENIORITY_VALUES). "Head of" is not a LinkedIn
// level; it is searched as director, the closest band.
const SENIORITY_TO_SALESNAV: Record<SeniorityBand, string> = {
  c_level: 'cxo', founder: 'owner/partner', vp: 'vice_president', head: 'director',
  director: 'director', manager: 'experienced_manager', senior: 'senior',
};

/**
 * Derive the Sales Navigator ask from the fit criteria — the single source of
 * both columns. Keys and shapes follow tools/prospecting.py _resolve_filters:
 * plain words for id-bearing filters, LinkedIn enums for seniority,
 * {min,max} bands for headcount.
 */
export function buildSalesNavFilters(c: IcpCriteria): {
  filters: Record<string, unknown>;
  search_keywords: string;
} {
  const filters: Record<string, unknown> = {};
  if (c.locations.length) filters.location = [...c.locations];
  if (c.industries.length) filters.industry = [...c.industries];

  const sen = Array.from(new Set(c.seniority.map((b) => SENIORITY_TO_SALESNAV[b]).filter(Boolean)));
  if (sen.length) filters.seniority = sen;

  const bands = COMPANY_SIZES.filter((s) => c.company_sizes.includes(s.key))
    .map((s) => (s.max === null ? { min: s.min } : { min: s.min, max: s.max }));
  if (bands.length) filters.company_headcount = bands;

  const chosen = new Set(c.titles.map((t) => t.toLowerCase()));
  const fns = Array.from(new Set(
    ROLE_GROUPS.filter((g) => g.fn && g.titles.some((t) => chosen.has(t.toLowerCase())))
      .map((g) => g.fn as string),
  ));
  if (fns.length) filters.function = fns;

  const search_keywords = c.titles.slice(0, 8).map((t) => `"${t}"`).join(' OR ');
  return { filters, search_keywords };
}

/** One-line human summary for list cards. */
export function summarizeCriteria(c: IcpCriteria): string {
  const parts: string[] = [];
  if (c.titles.length) parts.push(c.titles.slice(0, 3).join(', ') + (c.titles.length > 3 ? ` +${c.titles.length - 3}` : ''));
  if (c.industries.length) parts.push(c.industries.slice(0, 2).join(', ') + (c.industries.length > 2 ? ` +${c.industries.length - 2}` : ''));
  if (c.locations.length) parts.push(c.locations.slice(0, 3).join(', ') + (c.locations.length > 3 ? ` +${c.locations.length - 3}` : ''));
  if (c.company_sizes.length) parts.push(`${c.company_sizes.length} size band${c.company_sizes.length > 1 ? 's' : ''}`);
  return parts.join(' · ') || 'No criteria yet';
}

/** Suggestion shape returned by /api/icp/suggest (website → ICP). */
export interface IcpSuggestion {
  company_name: string | null;
  description: string | null;
  titles: string[];
  seniority: SeniorityBand[];
  industries: string[];
  locations: string[];
  company_sizes: string[];
  exclude_titles: string[];
  exclude_companies: string[];
  keywords: string[];
  rationale: string | null;
}
