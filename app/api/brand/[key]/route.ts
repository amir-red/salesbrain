import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * Change a brand (core 079). Any signed-in person may edit; every change is audited in the kernel.
 *   PATCH {fields, ai_drafted?}                     brand fields; ai_drafted names fields that came from the website draft
 *   POST  {type: product|competitor|template, item, personal?}   create (no id) or change (id) one item
 *   POST  {action: 'archive', type, id}             archive one item (nothing is deleted)
 */
export async function PATCH(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { fields?: Record<string, unknown>; ai_drafted?: string[] } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.fields || typeof body.fields !== 'object') return NextResponse.json({ error: 'fields required' }, { status: 400 });
  try {
    const out = await kernelCall('crm_brand_update', {
      brand: params.key, fields: body.fields, ...(Array.isArray(body.ai_drafted) ? { ai_drafted: body.ai_drafted } : {}),
    }, session.userId);
    return NextResponse.json(out, { status: out.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

const TOOL: Record<string, [string, string]> = {
  product: ['crm_product_upsert', 'product'], competitor: ['crm_competitor_upsert', 'competitor'],
  template: ['crm_template_upsert', 'template'],
};

export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { action?: string; type?: string; id?: string; item?: Record<string, unknown>; personal?: boolean } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const kind = body.type ?? '';
  if (!TOOL[kind]) return NextResponse.json({ error: 'type must be product, competitor or template' }, { status: 400 });
  try {
    if (body.action === 'archive') {
      if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const out = await kernelCall('crm_brand_archive', { kind, item_id: body.id }, session.userId);
      return NextResponse.json(out, { status: out.error ? 400 : 200 });
    }
    if (!body.item || typeof body.item !== 'object') return NextResponse.json({ error: 'item required' }, { status: 400 });
    const [tool, arg] = TOOL[kind];
    const out = await kernelCall(tool, {
      brand: params.key, [arg]: body.item, ...(kind === 'template' && body.personal ? { personal: true } : {}),
    }, session.userId);
    return NextResponse.json(out, { status: out.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
