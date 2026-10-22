import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * One campaign.
 *   GET   /api/campaigns/[id]                    the campaign, its lists, the graph being edited + its validation
 *   PATCH /api/campaigns/[id] { fields?, lists?, graph? }
 *         fields: name, goal, writing_context, language, product_id, settings{daily_max_per_step}
 *         graph:  the canvas autosave (draft_graph) — a live campaign keeps running on the published one
 *   POST  /api/campaigns/[id] { action }         check | launch | pause | resume | archive | discard | test
 *         test: { prospect_id?, choices? } walks one person through the graph; nothing is drafted or sent
 * The kernel checks owner / admin on every write.
 */
function fail(err: unknown, status = 400) {
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json(await kernelCall('crm_campaign_get', { campaign_id: params.id }, session.userId)); }
  catch (err) { return fail(err, 404); }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { fields?: Record<string, unknown>; lists?: unknown[]; graph?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  try {
    if (body.graph !== undefined) {
      return NextResponse.json(await kernelCall('campaign_save_graph', { campaign_id: params.id, graph: body.graph }, session.userId));
    }
    return NextResponse.json(await kernelCall('campaign_update', {
      campaign_id: params.id, fields: body.fields ?? {}, ...(Array.isArray(body.lists) ? { lists: body.lists.slice(0, 20) } : {}),
    }, session.userId));
  } catch (err) { return fail(err); }
}

const ACTIONS: Record<string, string> = {
  check: 'campaign_launch_check', launch: 'campaign_launch', pause: 'crm_campaign_pause', resume: 'crm_campaign_resume',
  archive: 'campaign_archive', discard: 'campaign_discard_draft', test: 'campaign_test_run',
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { action?: string; prospect_id?: string; choices?: Record<string, string> } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const tool = ACTIONS[body.action ?? ''];
  if (!tool) return NextResponse.json({ error: `action must be one of ${Object.keys(ACTIONS).join(', ')}` }, { status: 400 });
  const args: Record<string, unknown> = { campaign_id: params.id };
  if (body.action === 'test') {
    if (body.prospect_id) args.prospect_id = body.prospect_id;
    if (body.choices && typeof body.choices === 'object') args.choices = body.choices;
  }
  try { return NextResponse.json(await kernelCall(tool, args, session.userId)); }
  catch (err) { return fail(err); }
}
