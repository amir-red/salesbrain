import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/** Step 4 — enrich one lead now (employer, research, warm angles, email). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { kinds?: string[] } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const allowed = new Set(['employer', 'research', 'warm', 'email']);
  const kinds = (body.kinds || []).filter((k) => allowed.has(k));
  try {
    const out = await kernelCall('crm_enrich_prospect', { prospect_id: params.id, ...(kinds.length ? { kinds } : {}) }, session.userId);
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
