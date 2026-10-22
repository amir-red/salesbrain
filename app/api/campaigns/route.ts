import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * Campaigns (core 081) — org-wide list, like /pipeline.
 *   GET  /api/campaigns?archived=1        every campaign with its lists and live counts
 *   POST /api/campaigns { name, lists: [{icp_id}|{source}], product_id?, goal?, writing_context?, language?,
 *                         start_from: 'default'|'blank', spec?, daily_max_per_step? }
 *                         a new DRAFT, owned by the caller. `spec` = the wizard's answers; the kernel draws the sequence
 */
function fail(err: unknown, status = 400) {
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const archived = req.nextUrl.searchParams.get('archived') === '1';
  try { return NextResponse.json(await kernelCall('crm_campaigns_list', { include_archived: archived }, session.userId)); }
  catch (err) { return fail(err, 502); }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const name = String(body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'A campaign needs a name' }, { status: 400 });
  const lists = Array.isArray(body.lists) ? body.lists.slice(0, 20) : [];
  try {
    return NextResponse.json(await kernelCall('campaign_create', {
      name: name.slice(0, 120), lists,
      product_id: body.product_id || null, goal: body.goal || null, writing_context: body.writing_context || null,
      language: body.language || null, start_from: body.start_from === 'blank' ? 'blank' : 'default',
      ...(body.spec && typeof body.spec === 'object' ? { spec: body.spec } : {}),
      ...(Number(body.daily_max_per_step) > 0 ? { daily_max_per_step: Number(body.daily_max_per_step) } : {}),
    }, session.userId), { status: 201 });
  } catch (err) { return fail(err); }
}
