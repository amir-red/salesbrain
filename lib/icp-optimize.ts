/**
 * ICP optimizer — the shared engine behind the service `suggest_icp` tool and
 * the in-app builder's "Suggest ICPs" action. Turns partial input (website /
 * product / description / a partial criteria or filters) into 2–4 CANDIDATE
 * ICPs, each scored 1–5 on the five strategic objectives (speed_to_market,
 * volume, margin, logo, test_cases) so the tradeoff is visible, biased toward a
 * chosen primary objective when given, with one recommended.
 *
 * Objectives shape WHICH segment to chase; they are orthogonal to the scoring
 * weights. The per-candidate objective_scores are decision aids — never stored.
 * Nothing here is persisted; the caller confirms a candidate, then saves it via
 * crm_icp_define / POST /api/icp.
 *
 * Server-only (LLM + site fetch). Reuses lib/llm + lib/icp-site + the builder
 * vocabulary in lib/icp.
 */

import { anthropic, MODEL } from './llm';
import { fetchSite } from './icp-site';
import {
  COMPANY_SIZES, INDUSTRIES, LOCATION_GROUPS, ROLE_GROUPS, SENIORITY_BANDS,
  EXCLUDE_TITLE_PRESETS, DEFAULT_WEIGHTS, OBJECTIVES, OBJECTIVE_KEYS,
} from './icp';
import type { IcpCandidate, IcpOptimizeResult, ObjectiveKey, ObjectiveScores } from './icp';

export interface IcpOptimizeInput {
  name?: string;
  product?: string;
  website?: string;
  description?: string;
  criteria?: Record<string, unknown>;
  filters?: Record<string, unknown>;
  objective?: string;         // one of OBJECTIVE_KEYS
  n_candidates?: number;      // 2–4, default 3
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

const bands = new Set<string>(SENIORITY_BANDS.map((b) => b.key));
const sizes = new Set<string>(COMPANY_SIZES.map((s) => s.key));

function clampScore(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, n));
}

function normalizeScores(raw: unknown): ObjectiveScores {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = {} as ObjectiveScores;
  for (const k of OBJECTIVE_KEYS) out[k] = clampScore(r[k]);
  return out;
}

function normalizeCandidate(raw: Record<string, unknown>, fallbackName: string, fallbackProduct: string | null): IcpCandidate {
  const c = ((raw.criteria || {}) as Record<string, unknown>);
  const f = ((raw.filters || {}) as Record<string, unknown>);
  const w = ((c.weights || {}) as Record<string, unknown>);
  const weights: Record<string, number> = { ...DEFAULT_WEIGHTS };
  for (const k of Object.keys(weights)) {
    const n = Number(w[k]);
    if (Number.isFinite(n) && n >= 0) weights[k] = Math.round(n);
  }
  return {
    suggestion: {
      name: raw.name ? String(raw.name) : fallbackName,
      product: raw.product && raw.product !== 'null' ? String(raw.product) : fallbackProduct,
      search_keywords: raw.search_keywords ? String(raw.search_keywords) : '',
      filters: {
        location: list(f.location, 6),
        industry: list(f.industry, 8),
        function: list(f.function, 6),
        company: list(f.company, 10),
      },
      criteria: {
        titles: list(c.titles),
        seniority: list(c.seniority).filter((s) => bands.has(s)) as never,
        locations: list(c.locations, 6),
        industries: list(c.industries, 8),
        company_sizes: list(c.company_sizes).filter((s) => sizes.has(s)),
        exclude_titles: list(c.exclude_titles).map((s) => s.toLowerCase()),
        exclude_companies: list(c.exclude_companies),
        weights: weights as never,
      },
    },
    objective_scores: normalizeScores(raw.objective_scores),
    rationale: raw.rationale ? String(raw.rationale) : null,
    assumptions: list(raw.assumptions, 12),
    confidence: ['high', 'medium', 'low'].includes(String(raw.confidence)) ? String(raw.confidence) as IcpCandidate['confidence'] : 'medium',
  };
}

export async function optimizeIcp(input: IcpOptimizeInput): Promise<IcpOptimizeResult | { error: string }> {
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

  const objective = OBJECTIVE_KEYS.includes(input.objective as ObjectiveKey) ? (input.objective as ObjectiveKey) : null;
  const n = Math.min(4, Math.max(2, Number(input.n_candidates) || 3));

  const allTitles = ROLE_GROUPS.flatMap((g) => g.titles);
  const allLocations = LOCATION_GROUPS.flatMap((g) => g.items);
  const objList = OBJECTIVES.map((o) => `${o.key} (${o.label}: ${o.hint})`).join('\n  - ');

  const prompt = `You are a B2B go-to-market strategist. The caller wants to run outreach but has only PARTIAL information about who to target, and needs to DECIDE which ideal-customer profile (ICP) to chase. Propose ${n} distinct, well-formed CANDIDATE ICPs and score each against five strategic objectives so the tradeoff is clear.

What the caller provided:
${material.join('\n\n')}

The five objectives (score EACH candidate 1–5 on EVERY one — 5 = excellent, 1 = poor):
  - ${objList}
${objective ? `\nThe caller's PRIMARY objective is "${objective}". Make the FIRST candidate the one best optimized for it (this is the recommendation), and make the others meaningfully different alternatives (a different segment, size band, or geography) that trade off toward other objectives.` : `\nNo primary objective was given. Make the candidates span different objectives — e.g. one tuned for volume, one for margin, one for logo — so the caller can see the options.`}

For EACH candidate:
- A complete ICP: map to the vocabularies below where one fits (free text only when nothing fits); propose "weights" over {title, seniority, location, industry, size, network} summing to 100 (default shape ${JSON.stringify(DEFAULT_WEIGHTS)}).
- "objective_scores": an integer 1–5 for every one of the five objectives.
- "assumptions": everything you INFERRED (was not given) as short "we assumed X — confirm?" notes.
- "confidence": "high" | "medium" | "low".
- "rationale": one sentence on who this candidate targets and why its scores look as they do.

Vocabularies:
- titles: ${allTitles.join('; ')}
- seniority (subset): ${SENIORITY_BANDS.map((b) => b.key).join(', ')}
- functions for filters.function (subset): ${FUNCTIONS.join(', ')}
- industries: ${INDUSTRIES.join('; ')}
- locations: ${allLocations.join('; ')}
- company_sizes (use the keys): ${COMPANY_SIZES.map((s) => s.key).join(', ')}
- exclude_titles: ${EXCLUDE_TITLE_PRESETS.join(', ')}

Return ONLY JSON:
{
  "recommended_index": 0,
  "candidates": [
    {
      "name": "short ICP name",
      "product": "zeami | chipchip | null",
      "search_keywords": "free-text LinkedIn query",
      "filters": { "location": [], "industry": [], "function": [], "company": [] },
      "criteria": { "titles": [], "seniority": [], "locations": [], "industries": [], "company_sizes": [], "exclude_titles": [], "exclude_companies": [], "weights": { "title": 40, "seniority": 20, "location": 20, "industry": 15, "size": 0, "network": 5 } },
      "objective_scores": { "speed_to_market": 3, "volume": 3, "margin": 3, "logo": 3, "test_cases": 3 },
      "rationale": "…",
      "assumptions": ["we assumed … — confirm?"],
      "confidence": "medium"
    }
  ]
}`;

  let raw: Record<string, unknown> | null = null;
  try {
    const res = await anthropic.messages.create({
      model: MODEL, max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n');
    raw = extractJson(text);
  } catch (err) {
    return { error: `Model call failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!raw || !Array.isArray(raw.candidates) || raw.candidates.length === 0) {
    return { error: 'The model returned no usable candidates — add a bit more detail and retry.' };
  }

  const candidates = (raw.candidates as Record<string, unknown>[])
    .slice(0, n)
    .map((c, i) => normalizeCandidate(c, input.name || `Candidate ${i + 1}`, input.product || null));
  let rec = Number(raw.recommended_index);
  if (!Number.isInteger(rec) || rec < 0 || rec >= candidates.length) rec = 0;

  return {
    objective,
    recommended_index: rec,
    candidates,
    source,
    note: 'Nothing was saved. Review the candidates, pick one, edit if needed, then define the ICP with the confirmed profile.',
  };
}
