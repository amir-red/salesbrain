import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { exec_convert_prospect_to_deal } from '@/lib/prospect-executors';

const Schema = z.object({
  deal_name: z.string().optional(),
  initial_value: z.number().optional(),
  currency: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown = {};
  try { body = await req.json(); } catch { /* allow empty body */ }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const result = await exec_convert_prospect_to_deal(
    { prospect_id: params.id, ...parsed.data },
    { userId: session.userId }
  );
  if (result.error) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
