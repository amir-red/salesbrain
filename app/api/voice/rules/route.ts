import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * Voice rules (core 079). GET ?brand=&icp_id=&all=1 → the viewer's own rules, the brand's team rules and one list's
 * rules (all=1 includes forgotten ones). POST {content, kind?, scope?, brand?, icp_id?, channels?, steps?} → a rule
 * someone states; live at once (own voice by default; team = everyone writing for the brand).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  try {
    const out = await kernelCall('crm_voice_rules', {
      ...(sp.get('brand') ? { brand: sp.get('brand') } : {}),
      ...(sp.get('icp_id') ? { icp_id: sp.get('icp_id') } : {}),
      ...(sp.get('all') === '1' ? { include_inactive: true } : {}),
    }, session.userId);
    return NextResponse.json(out, { status: out.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) return NextResponse.json({ error: 'Write the rule first' }, { status: 400 });
  const pick = (k: string) => (body[k] !== undefined && body[k] !== '' ? { [k]: body[k] } : {});
  try {
    const out = await kernelCall('crm_voice_rule_add', {
      content, source: 'app', ...pick('kind'), ...pick('scope'), ...pick('brand'), ...pick('icp_id'),
      ...pick('channels'), ...pick('steps'),
    }, session.userId);
    return NextResponse.json(out, { status: out.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
