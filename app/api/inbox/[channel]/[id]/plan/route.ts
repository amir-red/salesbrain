/**
 * The conversation plan on one Inbox conversation (core 103): "no reply now — follow up on <date> because …", or
 * "leave it because …". Owner or admin reads; only the OWNER (or an admin) decides — a plan is a person's decision and
 * the suggestions learn from it, so the service account never writes one.
 *
 *   GET            → { plan, suggestion, habit, reasons, max_steps }      (kernel conversation_plan_get)
 *   POST  { decision: 'follow_up'|'leave', reason_kind, reason?, steps?: [{days|due_at, purpose?}], suggested? }
 *   DELETE { plan_id }                                                     (cancel: the thread goes back to needs reply)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

type Ctx = { params: { channel: string; id: string } };
const CHANNELS = new Set(['email', 'linkedin', 'chat']);

function parse(params: Ctx['params']) {
  if (!CHANNELS.has(params.channel) || !/^[0-9a-f-]{36}$/i.test(params.id)) return null;
  return { channel: params.channel, id: params.id };
}

async function call(tool: string, args: Record<string, unknown>, userId: string) {
  try {
    const out = await kernelCall(tool, args, userId) as Record<string, unknown>;
    if (out && typeof out.error === 'string') {
      const status = /not your|cannot set|service account/.test(out.error) ? 403 : /not found/i.test(out.error) ? 404 : 400;
      return NextResponse.json({ error: out.error }, { status });
    }
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const p = parse(params);
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return call('conversation_plan_get', { channel: p.channel, thread_id: p.id }, session.userId);
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const p = parse(params);
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let body: { decision?: string; reason_kind?: string; reason?: string; steps?: unknown; suggested?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (body.decision !== 'follow_up' && body.decision !== 'leave') return NextResponse.json({ error: "decision must be 'follow_up' or 'leave'" }, { status: 400 });
  if (!body.reason_kind) return NextResponse.json({ error: 'Pick a reason.' }, { status: 400 });
  const steps = Array.isArray(body.steps) ? body.steps.slice(0, 5) : [];
  return call('conversation_plan_set', {
    channel: p.channel, thread_id: p.id, decision: body.decision, reason_kind: String(body.reason_kind),
    reason: typeof body.reason === 'string' ? body.reason.slice(0, 500) : null,
    steps, ...(body.suggested && typeof body.suggested === 'object' ? { suggested: body.suggested } : {}),
  }, session.userId);
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!parse(params)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let body: { plan_id?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  if (!body.plan_id || !/^[0-9a-f-]{36}$/i.test(body.plan_id)) return NextResponse.json({ error: 'plan_id required' }, { status: 400 });
  return call('conversation_plan_cancel', { plan_id: body.plan_id }, session.userId);
}
