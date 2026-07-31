import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { anthropic, MODEL } from '@/lib/llm';
import { getSession } from '@/lib/auth';


const SummarySchema = z.object({
  contact_count: z.number().int().nonnegative(),
  account_count: z.number().int().nonnegative(),
  top_industries: z.array(z.object({ industry: z.string(), contact_count: z.number().int() })).max(10),
  top_companies: z.array(z.object({ company: z.string(), contact_count: z.number().int() })).max(10),
  top_locations: z.array(z.object({ location: z.string(), contact_count: z.number().int() })).max(10),
  neglected_count: z.number().int().nonnegative(),     // no contact in 90d
  warm_but_cold_count: z.number().int().nonnegative(), // has linkedin but never emailed
  // Compact, per-contact mini-records (capped 100) — let Claude reference contact_id
  contacts_sample: z.array(z.object({
    contact_id: z.string().uuid(),
    full_name: z.string().nullable(),
    title: z.string().nullable(),
    company: z.string().nullable(),
    industry: z.string().nullable(),
    has_email: z.boolean(),
    has_linkedin: z.boolean(),
    has_prospect: z.boolean(),
    has_deal: z.boolean(),
    last_contacted_days: z.number().nullable(),
  })).max(200),
});

/**
 * POST /api/network/insights
 * Receives a graph summary computed client-side, runs Claude, returns structured insights JSON.
 * Separate endpoint from /api/agent so it doesn't burn deal-context tokens.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = SummarySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }
  const summary = parsed.data;

  if (summary.contact_count === 0) {
    return NextResponse.json({ error: 'No contacts to analyze' }, { status: 400 });
  }

  const systemPrompt = `You are a sales relationship-intelligence analyst. You're given a compact summary of a salesperson's LinkedIn / CRM network. Your job: surface 5 categories of actionable insights as STRICT JSON.

Return ONLY a JSON object (no prose, no markdown fences) with these keys:
{
  "high_value_contacts": [{"contact_id": "uuid", "reason": "..."}],            // top 5 contacts that look high-leverage; senior titles, big companies, neglected
  "warm_intro_paths": [{"from_contact_id": "uuid", "to_company": "...", "reason": "..."}],  // contacts who could intro to a company
  "industry_clusters_with_potential": [{"industry": "...", "contact_count": N, "action": "..."}],
  "neglected_but_valuable": [{"contact_id": "uuid", "last_contacted_days": N, "reason": "..."}],  // top 5 neglected (>=60d) but with strong title/company
  "best_next_outreach": [{"contact_id": "uuid", "suggested_message_hook": "..."}]  // top 5 ready-to-act contacts
}

Rules:
- ALL contact_id values MUST appear in the input contacts_sample.
- Each array max 5 items. Empty array is fine if nothing qualifies.
- Reasons under 140 chars each. Hooks under 200 chars.
- Be specific (cite title/company), not generic.`;

  try {
    const resp = await anthropic.messages.create({
      // Shared constant, never a literal — a direct-API id does not exist on
      // Bedrock, where the client actually sends. See lib/llm.ts.
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: JSON.stringify(summary) }],
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    // Strip markdown fences if Claude added them anyway
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

    let insights: unknown;
    try {
      insights = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: 'Model returned invalid JSON', raw: text }, { status: 502 });
    }
    return NextResponse.json(insights);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Insights generation failed' },
      { status: 500 }
    );
  }
}
