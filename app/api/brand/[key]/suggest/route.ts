import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { MODEL } from '@/lib/llm';
import { createMessage } from '@/lib/llm-usage';
import { fetchSite } from '@/lib/icp-site';

/**
 * "Draft from website" for a brand (core 079). Reads the site (lib/icp-site) plus anything the person typed, and
 * returns a SUGGESTION — nothing is saved. The page shows it next to what is there; "Use these" saves through PATCH
 * with ai_drafted so the fields show as AI-drafted until a person edits them.
 *
 * Lesson from Guhan's onboarding (docs/research/04): a website read that returns the slogan as the value
 * proposition and leaves pain points empty is worse than nothing. The prompt asks for concrete pain and plain
 * language, and to leave a field empty rather than fill it with marketing copy.
 */
function extractJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
}
const str = (v: unknown, cap = 1500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, cap) : null);

export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { website?: string; notes?: string } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const { rows } = await pool.query('SELECT name, website FROM brands WHERE key = $1', [params.key]);
  if (!rows[0]) return NextResponse.json({ error: 'No such brand' }, { status: 404 });
  const website = (body.website || rows[0].website || '').trim();
  const notes = (body.notes || '').trim().slice(0, 3000);
  const site = website ? await fetchSite(website) : { url: '', pages: [] as { url: string; text: string }[] };
  if (site.pages.length === 0 && notes.length < 40) {
    return NextResponse.json({ error: website
      ? `Couldn't read ${site.url || website}. Write a few sentences about what you sell and to whom, then try again.`
      : 'Add the website, or write a few sentences about what you sell and to whom.' }, { status: 422 });
  }
  const prompt = `You brief a new sales rep on the company ${rows[0].name}, so they can write to prospects.
${site.pages.length ? `Website content:\n${site.pages.map((p) => `--- ${p.url} ---\n${p.text}`).join('\n\n')}` : ''}
${notes ? `What the team says about itself:\n${notes}` : ''}

Write plainly, as a colleague would explain it — no slogans, no marketing adjectives. If the content does not say
something, leave that field empty ("") rather than guessing. Never copy a tagline as the description.

Return ONLY JSON:
{
  "industry": "the industry they sell INTO or operate in, a few words",
  "description": "2–3 plain sentences: what the company does, for whom, and the concrete result for the customer",
  "pain_points": "the specific problems their customers have before buying — who, what goes wrong, what it costs; 2–4 sentences",
  "tone": "one of professional | conversational | direct | authoritative | technical | casual | consultative — how their own site talks",
  "language": "the main language of the site as an ISO code (en, de, ...)",
  "products": [{"name": "…", "description": "one plain paragraph", "pain": "the problem this product solves"}],
  "competitors": [{"name": "…", "differentiation": "how this company differs, only if the site says so"}]
}`;
  let raw: Record<string, unknown> | null = null;
  try {
    const res = await createMessage({ model: MODEL, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] },
      { feature: 'brand_suggest', userId: session.userId });
    raw = extractJson(res.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n'));
  } catch (err) {
    return NextResponse.json({ error: `Model call failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
  if (!raw) return NextResponse.json({ error: 'The model returned nothing usable — try again or fill it in by hand.' }, { status: 502 });
  const tones = ['professional', 'conversational', 'direct', 'authoritative', 'technical', 'casual', 'consultative'];
  const items = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').slice(0, 6) : []) as Record<string, unknown>[];
  return NextResponse.json({
    suggestion: {
      industry: str(raw.industry, 120), description: str(raw.description), pain_points: str(raw.pain_points),
      tone: typeof raw.tone === 'string' && tones.includes(raw.tone) ? raw.tone : null,
      language: str(raw.language, 10),
      products: items(raw.products).map((p) => ({ name: str(p.name, 120), description: str(p.description), pain: str(p.pain) }))
        .filter((p) => p.name),
      competitors: items(raw.competitors).map((c) => ({ name: str(c.name, 120), differentiation: str(c.differentiation) }))
        .filter((c) => c.name),
    },
    source_url: site.url || null, pages_read: site.pages.length,
  });
}
