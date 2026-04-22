import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { exec_research_company_from_url } from '@/lib/prospect-executors';

const Schema = z.object({
  website: z.string().min(1),
  prospect_id: z.string().uuid().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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

  const result = await exec_research_company_from_url({
    account_id: params.id,
    website: parsed.data.website,
    prospect_id: parsed.data.prospect_id,
  });
  if (result.error) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
