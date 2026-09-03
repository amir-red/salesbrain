/**
 * ICP optimizer for the service surface. The sibling app often has only
 * partial information (a product name, a sentence, maybe a website, maybe a
 * rough draft of who to target). This asks Claude to COMPLETE and OPTIMIZE
 * that into a full ICP mapped to LinkedIn's vocabulary — filters + scoring
 * criteria + weights — and, crucially, to list what it INFERRED so a human
 * confirms before we spend LinkedIn quota sourcing against it.
 *
 * Nothing is persisted. The other app shows the suggestion, the user edits/
 * confirms, then calls crm_icp_define with the final version.
 *
 * Server-only (LLM + site fetch). Reuses lib/llm + lib/icp-site + the builder
 * vocabulary in lib/icp so a suggestion lands as selections, not free text.
 */

import { anthropic, MODEL } from '../llm';
import { fetchSite } from '../icp-site';
import {
  COMPANY_SIZES, INDUSTRIES, LOCATION_GROUPS, ROLE_GROUPS, SENIORITY_BANDS,
  EXCLUDE_TITLE_PRESETS, DEFAULT_WEIGHTS,
} from '../icp';

export interface IcpSuggestInput {
  name?: string;
  product?: string;
  website?: string;
  description?: string;
  // Whatever partial targeting the other system already has.
  criteria?: Record<string, unknown>;
  filters?: Record<string, unknown>;
}

function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

const list = (v: unknown, max = 14): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max) : [];

const FUNCTIONS = ['Operations', 'Finance', 'Engineering', 'Product Management', 'Sales', 'Human Resources', 'Information Technology'];

export async function suggestIcp(input: IcpSuggestInput): Promise<Record<string, unknown>> {
  const material: string[] = [];
  let source = 'input';

  const website = (input.website || '').trim();
  if (website && /^[\w.-]+\.[a-z]{2,}/i.test(website.replace(/^https?:\/\//, ''))) {
    const site = await fetchSite(website);
    if (site.pages.length) {
      material.push(`Website ${site.url}:\n${site.pages.map((p) => `--- ${p.url} ---\n${p.text}`).join('\n\n').slice(0, 12000)}`);
      source = 'website';
    }
  }
  if (input.product) material.push(`Product line: ${input.product}`);
  if (input.description) material.push(`Description: ${input.description}`);
  if (input.criteria && Object.keys(input.criteria).length) material.push(`Partial criteria the caller already has: ${JSON.stringify(input.criteria)}`);
  if (input.filters && Object.keys(input.filters).length) material.push(`Partial filters the caller already has: ${JSON.stringify(input.filters)}`);
  if (!material.length) {
    return { error: 'Give at least one of: website, product, description, or a partial criteria/filters to optimize.' };
  }

  const allTitles = ROLE_GROUPS.flatMap((g) => g.titles);
  const allLocations = LOCATION_GROUPS.flatMap((g) => g.items);

  const prompt = `You are a B2B go-to-market analyst. The caller wants to run outreach but has only PARTIAL information about who to target. Turn what they gave into a COMPLETE, well-formed ideal-customer profile (ICP) — the people most likely to BUY, not the vendor's own staff or competitors.

What the caller provided:
${material.join('\n\n')}

Your job:
- Fill every gap sensibly. Where the caller gave a value, keep it unless it's clearly wrong; where they gave nothing, INFER a reasonable default from the product/context.
- Map to the vocabularies below wherever one fits (so it lands as selections, not free text); add free text only when nothing fits.
- Propose scoring "weights" over {title, seniority, location, industry, size, network} that sum to 100 (default shape ${JSON.stringify(DEFAULT_WEIGHTS)} — adjust to what matters for this ICP).
- CRUCIAL: list everything you INFERRED (was not given to you) in "assumptions", each as a short "we assumed X — confirm?" note, so a human can confirm before sourcing spends LinkedIn quota.
- Give an overall "confidence": "high" | "medium" | "low" based on how much real signal you had.

Vocabularies:
- titles (pick 4–10): ${allTitles.join('; ')}
- seniority (subset): ${SENIORITY_BANDS.map((b) => b.key).join(', ')}
- functions/departments for filters.function (subset): ${FUNCTIONS.join(', ')}
- industries (pick 3–8): ${INDUSTRIES.join('; ')}
- locations (pick 1–6): ${allLocations.join('; ')}
- company_sizes (use the keys, subset): ${COMPANY_SIZES.map((s) => s.key).join(', ')}
- exclude_titles (subset, add more): ${EXCLUDE_TITLE_PRESETS.join(', ')}

Return ONLY JSON:
{
  "name": "a short ICP name",
  "product": "zeami | chipchip | null",
  "search_keywords": "a free-text LinkedIn query, e.g. 'VP Operations fintech'",
  "filters": { "location": [], "industry": [], "function": [], "company": [] },
  "criteria": {
    "titles": [], "seniority": [], "locations": [], "industries": [], "company_sizes": [],
    "exclude_titles": [], "exclude_companies": [],
    "weights": { "title": 40, "seniority": 20, "location": 20, "industry": 15, "size": 0, "network": 5 }
  },
  "rationale": "1–2 sentences on why this ICP",
  "assumptions": ["we assumed ... — confirm?"],
  "confidence": "high | medium | low"
}`;

  let raw: Record<string, unknown> | null = null;
  try {
    const res = await anthropic.messages.create({
      model: MODEL, max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n');
    raw = extractJson(text);
  } catch (err) {
    return { error: `Model call failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!raw) return { error: 'The model returned no usable profile — add a bit more detail and retry.' };

  const bands = new Set<string>(SENIORITY_BANDS.map((b) => b.key));
  const sizes = new Set<string>(COMPANY_SIZES.map((s) => s.key));
  const c = (raw.criteria || {}) as Record<string, unknown>;
  const f = (raw.filters || {}) as Record<string, unknown>;
  const w = (c.weights || {}) as Record<string, unknown>;
  const weights: Record<string, number> = { ...DEFAULT_WEIGHTS };
  for (const k of Object.keys(weights)) {
    const n = Number(w[k]);
    if (Number.isFinite(n) && n >= 0) weights[k] = Math.round(n);
  }

  const suggestion = {
    name: input.name || (raw.name ? String(raw.name) : 'Suggested ICP'),
    product: raw.product && raw.product !== 'null' ? String(raw.product) : (input.product || null),
    search_keywords: raw.search_keywords ? String(raw.search_keywords) : '',
    filters: {
      location: list(f.location, 6),
      industry: list(f.industry, 8),
      function: list(f.function, 6),
      company: list(f.company, 10),
    },
    criteria: {
      titles: list(c.titles),
      seniority: list(c.seniority).filter((s) => bands.has(s)),
      locations: list(c.locations, 6),
      industries: list(c.industries, 8),
      company_sizes: list(c.company_sizes).filter((s) => sizes.has(s)),
      exclude_titles: list(c.exclude_titles).map((s) => s.toLowerCase()),
      exclude_companies: list(c.exclude_companies),
      weights,
    },
  };

  return {
    suggestion,
    rationale: raw.rationale ? String(raw.rationale) : null,
    assumptions: list(raw.assumptions, 12),
    confidence: ['high', 'medium', 'low'].includes(String(raw.confidence)) ? String(raw.confidence) : 'medium',
    source,
    note: 'Nothing was saved. Review + edit, then call crm_icp_define with the confirmed profile.',
  };
}
