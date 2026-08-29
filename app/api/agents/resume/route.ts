import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/** Lift an agent pause on a LinkedIn account (owner or admin) → crm_agent_resume_account. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { unipile_account_id?: string } = {};
  try { body = await req.json(); } catch { /* fallthrough */ }
  if (!body.unipile_account_id) return NextResponse.json({ error: 'unipile_account_id required' }, { status: 400 });
  try {
    const out = await kernelCall('crm_agent_resume_account', { unipile_account_id: body.unipile_account_id }, session.userId);
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
