import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import pool from '@/lib/db';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { guardEditable, visibleIcp } from '@/lib/icp-server';

/**
 * Who works a list (migration 085): back office (`responsible`), front office (`front`, empty = same as back office),
 * sender (whose LinkedIn / mailbox sends, empty = the back office's own). Every lead on the list inherits them.
 *
 * GET  — the seats with names + the effective person per seat (anyone signed in; lists are visible to everyone).
 * POST { responsible?, front?, sender?, apply_to_leads? } — owner or admin; each value is a user id or "" to clear.
 *      Goes through the kernel (commands/icp_owner.py::set_icp_seats) so open leads that still had the previous
 *      person move too, with a line on each lead's track record.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const icp = await visibleIcp(params.id, session);
  if (!icp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { rows } = await pool.query(
    `SELECT i.owner_user_id, o.name AS owner_name,
            i.responsible_user_id, r.name AS responsible_name, i.front_user_id, f.name AS front_name,
            i.sender_user_id, s.name AS sender_name
       FROM icp_profiles i JOIN users o ON o.id = i.owner_user_id
       LEFT JOIN users r ON r.id = i.responsible_user_id LEFT JOIN users f ON f.id = i.front_user_id
       LEFT JOIN users s ON s.id = i.sender_user_id
      WHERE i.id = $1`, [params.id]);
  const r = rows[0];
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const one = (id: string | null, name: string | null) => (id ? { id, name } : null);
  const back = one(r.responsible_user_id, r.responsible_name) ?? one(r.owner_user_id, r.owner_name);
  return NextResponse.json({
    responsible: one(r.responsible_user_id, r.responsible_name),
    front: one(r.front_user_id, r.front_name),
    sender: one(r.sender_user_id, r.sender_name),
    effective: {
      back_office: back,
      front_office: one(r.front_user_id, r.front_name) ?? back,
      sender: one(r.sender_user_id, r.sender_name) ?? back,
    },
    can_edit: icp.can_edit,
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const guard = await guardEditable(params.id, session);
  if (guard.denied) return guard.denied;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const args: Record<string, unknown> = { icp_id: params.id };
  for (const k of ['responsible', 'front', 'sender'] as const) {
    if (body[k] === undefined) continue;
    const v = body[k];
    if (typeof v !== 'string' || (v && !/^[0-9a-f-]{36}$/i.test(v))) {
      return NextResponse.json({ error: `${k} must be a user id or ""` }, { status: 400 });
    }
    args[k] = v;
  }
  if (Object.keys(args).length === 1) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
  if (typeof body.apply_to_leads === 'boolean') args.apply_to_leads = body.apply_to_leads;
  try {
    const out = await kernelCall('crm_icp_set_seats', args, session.userId) as Record<string, unknown>;
    if (out.error) return NextResponse.json(out, { status: out.refused ? 403 : 400 });
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not change the seats' }, { status: 502 });
  }
}
