import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/** POST {action:'forget'} archives a rule (undo a lesson); {action:'share', brand?} copies it into the team voice;
 * {action:'resolve'} keeps THIS side of a contested pair (a loaded playbook's contradiction) and archives the other. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { action?: string; brand?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const tool = body.action === 'forget' ? 'crm_voice_rule_forget' : body.action === 'share' ? 'crm_voice_rule_share'
    : body.action === 'resolve' ? 'crm_voice_conflict_resolve' : null;
  if (!tool) return NextResponse.json({ error: "action must be 'forget', 'share' or 'resolve'" }, { status: 400 });
  try {
    const args = body.action === 'resolve' ? { keep_rule_id: params.id } : { rule_id: params.id, ...(body.brand ? { brand: body.brand } : {}) };
    const out = await kernelCall(tool, args, session.userId);
    return NextResponse.json(out, { status: out.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
