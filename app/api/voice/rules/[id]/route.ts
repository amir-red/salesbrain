import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/** POST {action:'forget'} archives a rule (undo a lesson); {action:'share', brand?} copies it into the team voice. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { action?: string; brand?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const tool = body.action === 'forget' ? 'crm_voice_rule_forget' : body.action === 'share' ? 'crm_voice_rule_share' : null;
  if (!tool) return NextResponse.json({ error: "action must be 'forget' or 'share'" }, { status: 400 });
  try {
    const out = await kernelCall(tool, { rule_id: params.id, ...(body.brand ? { brand: body.brand } : {}) }, session.userId);
    return NextResponse.json(out, { status: out.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
