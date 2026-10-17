import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * POST /api/admin/learning/skill-remove {profile, name}
 * Take an agent-written skill out of service (the folder is moved to .removed/, not deleted). Skills are
 * live for everyone at once, so this is the brake. Git-deployed skills are refused by the ring. Admin only.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const profile = typeof body.profile === 'string' ? body.profile : '';
  const name = typeof body.name === 'string' ? body.name : '';
  if (!profile || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name)) {
    return NextResponse.json({ error: 'profile and a skill name are required' }, { status: 400 });
  }
  try {
    const out = await kernelCall('skill_remove', { profile, name }, session.userId);
    return NextResponse.json(out, { status: (out as { error?: string }).error ? 409 : 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Remove failed: ${msg}` }, { status: 502 });
  }
}
