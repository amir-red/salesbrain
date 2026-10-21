import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

export const maxDuration = 200;

/**
 * POST /api/firms/[id]/people { names? } — find the people at this firm NOW and add them to its list: the best
 * investment roles from the researched team (or exactly `names`), then each one's LinkedIn and email (~1-2 min).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { names?: string[] } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const args: Record<string, unknown> = { firm_id: params.id };
  if (Array.isArray(body.names) && body.names.length) args.names = body.names.slice(0, 10);
  try {
    return NextResponse.json(await kernelCall('crm_firm_find_people', args, session.userId));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
