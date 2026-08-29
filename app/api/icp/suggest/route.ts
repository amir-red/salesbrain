import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { anthropic, MODEL } from '@/lib/llm';
import { COMPANY_SIZES, INDUSTRIES, LOCATION_GROUPS, ROLE_GROUPS, SENIORITY_BANDS, EXCLUDE_TITLE_PRESETS } from '@/lib/icp';
import type { IcpSuggestion, SeniorityBand } from '@/lib/icp';
import { fetchSite } from '@/lib/icp-site';

/**
 * Website → draft ICP. The "paste your URL, we'll prefill everything" step.
 *
 * Reads the homepage (+ /about), asks Claude to infer who buys this product,
 * and returns chip-ready lists constrained to the builder's vocabulary where
 * one exists (industries, sizes, seniority) so the suggestion lands as
 * selections rather than free text. The user reviews every chip before saving —
 * nothing here is persisted.
 */

function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

const list = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max) : [];

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { website?: string; product?: string | null; description?: string | null };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const website = (body.website || '').trim();
  if (!website || !/^[\w.-]+\.[a-z]{2,}/i.test(website.replace(/^https?:\/\//, ''))) {
    return NextResponse.json({ error: 'Enter a website like zeami.io' }, { status: 400 });
  }

  const site = await fetchSite(website);
  const description = (body.description || '').trim();
  // Last resort: the user already wrote what the product is — draft from that.
  if (site.pages.length === 0 && description.length >= 40) {
    site.pages.push({ url: 'your description', text: description, via: 'html' });
  }
  if (site.pages.length === 0) {
    return NextResponse.json({
      error: `Couldn't read ${site.url} — it returned no text (JS-rendered, blocked, or down). Write 2–3 sentences in the description above and click Analyze again to draft from that instead.`,
    }, { status: 422 });
  }

  const allTitles = ROLE_GROUPS.flatMap((g) => g.titles);
  const allLocations = LOCATION_GROUPS.flatMap((g) => g.items);
  const prompt = `You are a B2B go-to-market analyst. From this company's website, infer its IDEAL CUSTOMER PROFILE — the people most likely to BUY this product (not the company's own staff, not its competitors' staff).

Website: ${site.url}
${body.product ? `Product line in our CRM: ${body.product}\n` : ''}
Website content:
${site.pages.map((p) => `--- ${p.url} ---\n${p.text}`).join('\n\n')}

Rules:
- Be specific to what the site actually sells. If it's unclear, keep lists short rather than guessing widely.
- Prefer values from the vocabularies below where one fits; add a free-text value only when nothing fits.
- "exclude_companies" = named competitors or the vendor itself (their employees are not buyers).
- Geography: US/Europe/global unless the site clearly targets a region.

Vocabularies:
- titles (pick 4–10, or add specific ones): ${allTitles.join('; ')}
- seniority (subset): ${SENIORITY_BANDS.map((b) => b.key).join(', ')}
- industries (pick 3–8): ${INDUSTRIES.join('; ')}
- locations (pick 1–6): ${allLocations.join('; ')}
- company_sizes (subset, use the keys): ${COMPANY_SIZES.map((s) => s.key).join(', ')}
- exclude_titles (subset, add more if relevant): ${EXCLUDE_TITLE_PRESETS.join(', ')}

Return ONLY JSON:
{
  "company_name": "string",
  "description": "1–2 sentences: what they sell and to whom",
  "titles": [], "seniority": [], "industries": [], "locations": [], "company_sizes": [],
  "exclude_titles": [], "exclude_companies": [],
  "keywords": ["topics buyers post about, 4–8"],
  "rationale": "one sentence on why this ICP"
}`;

  let raw: Record<string, unknown> | null = null;
  try {
    const res = await anthropic.messages.create({
      model: MODEL, max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n');
    raw = extractJson(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Model call failed: ${msg}` }, { status: 502 });
  }
  if (!raw) return NextResponse.json({ error: 'The model returned no usable profile — try again or fill by hand.' }, { status: 502 });

  const bands = new Set(SENIORITY_BANDS.map((b) => b.key));
  const sizes = new Set(COMPANY_SIZES.map((s) => s.key));
  const suggestion: IcpSuggestion = {
    company_name: raw.company_name ? String(raw.company_name) : null,
    description: raw.description ? String(raw.description) : null,
    titles: list(raw.titles),
    seniority: list(raw.seniority).filter((s): s is SeniorityBand => bands.has(s as SeniorityBand)),
    industries: list(raw.industries),
    locations: list(raw.locations),
    company_sizes: list(raw.company_sizes).filter((s) => sizes.has(s)),
    exclude_titles: list(raw.exclude_titles).map((s) => s.toLowerCase()),
    exclude_companies: list(raw.exclude_companies),
    keywords: list(raw.keywords, 10),
    rationale: raw.rationale ? String(raw.rationale) : null,
  };
  const source = site.pages[0].url === 'your description' ? 'description' : site.pages[0].via;
  return NextResponse.json({ suggestion, source_url: site.url, pages_read: site.pages.length, source });
}
