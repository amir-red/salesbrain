import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { exec_create_or_import_prospect } from '@/lib/prospect-executors';

const LeadSchema = z.object({
  company_name: z.string().min(1),
  website: z.string().optional(),
  domain: z.string().optional(),
  full_name: z.string().min(1),
  email: z.string().email().optional(),
  title: z.string().optional(),
  source_detail: z.string().optional(),
});

const Schema = z.object({
  campaign_id: z.string().uuid().optional(),
  source_type: z.string().default('manual_import'),
  leads: z.array(LeadSchema).min(1).max(500),
});

/**
 * Bulk-create prospects from a pasted list.
 * Each lead becomes an account (deduped globally by domain/name) + contact (deduped per-user)
 * + prospect (owned by the calling user).
 *
 * Does NOT fetch websites or draft emails — those are subsequent steps (use
 * /api/accounts/[id]/research and the agent's draft_outreach_message tool).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const lead of parsed.data.leads) {
    try {
      const res = await exec_create_or_import_prospect(
        {
          company_name: lead.company_name,
          domain: lead.domain || lead.website,
          full_name: lead.full_name,
          email: lead.email,
          title: lead.title,
          source_type: parsed.data.source_type,
          source_detail: lead.source_detail,
          campaign_id: parsed.data.campaign_id,
        },
        { userId: session.userId }
      );
      results.push({ input: lead, ...res });
    } catch (err) {
      results.push({ input: lead, error: err instanceof Error ? err.message : 'Failed' });
    }
  }

  const created = results.filter((r) => r.created === true).length;
  const existing = results.filter((r) => r.created === false).length;
  const errors = results.filter((r) => r.error).length;

  return NextResponse.json({ created, existing, errors, results });
}
