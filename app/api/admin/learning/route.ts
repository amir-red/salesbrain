import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * GET /api/admin/learning?profile= — Hermes' learning queue across bot
 * profiles: staged skill + memory writes (with diffs), loop status per
 * surface, the memory files, agent-authored skills. Admin only.
 *
 * Passthrough to the app-only kernel RPC `learning_pending` (ring
 * `salesbrain_hermes.learning`): reads files under /root/.hermes, so it can
 * only run on the box. Loaded on demand, not polled — a kernel call is a
 * subprocess.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const profile = req.nextUrl.searchParams.get('profile') || undefined;
  try {
    return NextResponse.json(await kernelCall('learning_pending', profile ? { profile } : {}, session.userId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Learning queue failed: ${msg}` }, { status: 502 });
  }
}
