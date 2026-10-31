import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/** GET — one person's trust score: parts, why, path, research with sources, feedback (kernel `crm_trust_score`). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const out = await kernelCall('crm_trust_score', { prospect_id: params.id }, session.userId);
    return NextResponse.json(out, { status: out.error ? 404 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
