import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { auditBestEffort, visibleIcp } from '@/lib/icp-server';

/**
 * File the next few LinkedIn connection requests for this list, for approval:
 * best fit first, one person per company before a second, never more than the
 * daily cap still allows. Sends nothing. The requests go out from the list
 * OWNER's LinkedIn account, so an admin on a colleague's list acts as the
 * owner (audited) — every request still needs the owner's 👍.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const icp = await visibleIcp(params.id, session);
  if (!icp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let body: { limit?: number } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const limit = Number.isFinite(Number(body.limit)) && Number(body.limit) > 0 ? Math.min(Math.floor(Number(body.limit)), 20) : undefined;
  const onBehalf = icp.owner_user_id !== session.userId;
  if (onBehalf) await auditBestEffort(session.userId, 'act_as', { icp_id: icp.id, as: icp.owner_user_id, command: 'crm_linkedin_connect_batch' });
  try {
    const out = (await kernelCall('crm_linkedin_connect_batch',
      { icp_id: icp.id, ...(limit ? { limit } : {}) }, icp.owner_user_id)) as Record<string, unknown>;
    return NextResponse.json({ ...out, acted_as: { user_id: icp.owner_user_id, name: icp.owner_name, on_behalf: onBehalf } },
      { status: out.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
