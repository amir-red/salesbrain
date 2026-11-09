import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * GET — the lead brief (2026-11-09): the eight answers for one person, read by the kernel's `lead_brief` (app-only
 * RPC). Readable by every signed-in teammate, like the person page itself. Nothing is written.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const out = await kernelCall('lead_brief', { prospect_id: params.id }, session.userId);
    return NextResponse.json(out, { status: out.error ? 404 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
