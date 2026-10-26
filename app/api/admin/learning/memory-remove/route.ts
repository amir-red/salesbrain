import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * POST /api/admin/learning/memory-remove {profile, entry}
 * Remove one entry from a profile's MEMORY.md through Hermes' own memory store. The chat bot's MEMORY.md is shared
 * by every teammate and written by the after-turn review without approval, so this is the brake. Admin only.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const profile = typeof body.profile === 'string' ? body.profile : '';
  const entry = typeof body.entry === 'string' ? body.entry.trim() : '';
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(profile) || !entry || entry.length > 4000) {
    return NextResponse.json({ error: 'profile and the entry text are required' }, { status: 400 });
  }
  try {
    const out = await kernelCall('memory_entry_remove', { profile, entry }, session.userId);
    return NextResponse.json(out, { status: (out as { error?: string }).error ? 409 : 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Remove failed: ${msg}` }, { status: 502 });
  }
}
