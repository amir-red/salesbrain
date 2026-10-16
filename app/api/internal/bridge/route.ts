import { NextRequest, NextResponse } from 'next/server';
import { verifyBridge } from '@/lib/bridge';
import { runBridgeTool } from '@/lib/bridge-tools';

/**
 * POST /api/internal/bridge  { tool, args, actor_user_id } — HMAC-signed, internal only. See lib/bridge.ts.
 * Called by the Hermes ring on this same machine; refuses anything that came through the public proxy.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const v = verifyBridge(req.headers, raw);
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: v.status });
  let msg: { tool?: string; args?: Record<string, unknown>; actor_user_id?: string };
  try { msg = JSON.parse(raw); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (!msg.tool || !msg.actor_user_id || !/^[0-9a-f-]{36}$/i.test(msg.actor_user_id)) {
    return NextResponse.json({ error: 'tool and actor_user_id required' }, { status: 400 });
  }
  return NextResponse.json(await runBridgeTool(msg.tool, msg.args || {}, msg.actor_user_id));
}
