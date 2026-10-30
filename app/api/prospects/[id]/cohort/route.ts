import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/** POST {cohort} — put one prospect on a cohort list (e.g. off Unsorted). The kernel lets its owner or an admin. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { cohort?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.cohort) return NextResponse.json({ error: 'Pick a cohort.' }, { status: 400 });
  try {
    const out = await kernelCall('cohort_move', { prospect_id: params.id, cohort_key: body.cohort }, session.userId);
    return NextResponse.json(out, { status: out.error ? (out.refused ? 403 : 400) : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
