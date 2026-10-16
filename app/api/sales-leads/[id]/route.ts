/**
 * One sales lead.
 *
 *   GET    /api/sales-leads/:id  — the row + its track record (newest first)
 *   PATCH  /api/sales-leads/:id  — any of: status (new|contacted|replied|archived; converting
 *                                  is /convert), priority (1 top … 10, 0 clears), rank (order inside the priority, 0 clears), must_talk,
 *                                  responsible_user_id / front_user_id ('' clears),
 *                                  next_contact_at (YYYY-MM-DD, '' clears), met_at,
 *                                  note (+ note_kind, channel, occurred_at) → a track-record
 *                                  event, notes (the free textarea, saved verbatim).
 *                                  Everything but `notes` goes through the kernel
 *                                  (crm_update_sales_lead) so it is audited and lands on the
 *                                  track record the same way the agent's edits do.
 *   DELETE /api/sales-leads/:id  — remove a lead entirely (admin; e.g. spam)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { CHANNELS } from '@/lib/sales-leads';

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const PatchSchema = z.object({
  status: z.enum(['new', 'contacted', 'replied', 'archived']).optional(),
  priority: z.number().int().min(0).max(10).optional(),  // 1 top … 10, 0 clears
  rank: z.number().int().min(0).max(9999).optional(),    // order inside the priority, 0 clears
  must_talk: z.boolean().optional(),
  responsible_user_id: z.string().optional(),   // uuid or '' to clear
  front_user_id: z.string().optional(),
  next_contact_at: z.union([Ymd, z.literal('')]).optional(),
  met_at: z.string().max(200).optional(),
  note: z.string().max(2000).optional(),
  note_kind: z.enum(['note', 'met', 'sent', 'reply', 'call', 'meeting']).optional(),
  channel: z.enum(CHANNELS).optional(),
  occurred_at: Ymd.optional(),
  notes: z.string().max(20000).optional(),
  full_name: z.string().min(1).max(200).optional(),
  title: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
  linkedin_url: z.string().max(300).optional(),
  next_step: z.string().max(200).optional(),     // '' clears
  journey_stage: z.number().int().min(0).max(5).optional(),
  intro_quality: z.number().int().min(0).max(5).optional(),
  journey_outcome: z.enum(['qualified', 'lost', '']).optional(),
}).strict();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT l.*, to_char(l.next_contact_at, 'YYYY-MM-DD') AS next_contact_at,
              r.name AS responsible_name, f.name AS front_name,
              EXTRACT(day FROM now() - COALESCE(l.last_contact_at, l.created_at))::int AS days_since_contact,
              l.raw_payload->>'prospect_id' AS prospect_id
         FROM sales_leads l
         LEFT JOIN users r ON r.id = l.responsible_user_id
         LEFT JOIN users f ON f.id = l.front_user_id
        WHERE l.id = $1`, [id]);
    if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { rows: events } = await client.query(
      `SELECT e.id, e.occurred_at, e.kind, e.channel, e.text, e.ref, e.actor_user_id, u.name AS actor_name
         FROM sales_lead_events e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.lead_id = $1 ORDER BY e.occurred_at DESC, e.created_at DESC LIMIT 200`, [id]);
    return NextResponse.json({ lead: rows[0], events });
  } finally {
    client.release();
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;

  // The free notes box is the person's own scratchpad: saved as typed, no event.
  if (b.notes !== undefined) {
    const { rowCount } = await pool.query('UPDATE sales_leads SET notes = $1 WHERE id = $2', [b.notes, id]);
    if (rowCount === 0) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }

  // Teammate ids → the kernel takes a name/email (so the agent can say "Hannes").
  const who = async (uid: string | undefined): Promise<string | undefined> => {
    if (uid === undefined) return undefined;
    if (uid === '') return '';
    const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [uid]);
    if (!rows[0]) throw new Error('Unknown teammate');
    return rows[0].email as string;
  };

  const args: Record<string, unknown> = { lead_id: id };
  if (b.status !== undefined) args.status = b.status;
  if (b.priority !== undefined) args.priority = b.priority;
  if (b.rank !== undefined) args.rank = b.rank;
  if (b.must_talk !== undefined) args.must_talk = b.must_talk;
  if (b.next_contact_at !== undefined) args.next_contact_at = b.next_contact_at;
  if (b.met_at !== undefined) args.met_at = b.met_at;
  for (const k of ['full_name', 'title', 'company', 'email', 'linkedin_url', 'next_step', 'journey_stage', 'intro_quality', 'journey_outcome'] as const) {
    if (b[k] !== undefined) args[k] = b[k];
  }
  if (b.note !== undefined && b.note.trim()) {
    args.note = b.note; args.note_kind = b.note_kind ?? 'note';
    if (b.channel) args.channel = b.channel;
    if (b.occurred_at) args.occurred_at = b.occurred_at;
  }
  try {
    const resp = await who(b.responsible_user_id);
    const front = await who(b.front_user_id);
    if (resp !== undefined) args.responsible = resp;
    if (front !== undefined) args.front = front;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  if (Object.keys(args).length === 1) return NextResponse.json({ updated: b.notes !== undefined });

  try {
    const out = await kernelCall('crm_update_sales_lead', args, session.userId) as Record<string, unknown>;
    if (out.error) return NextResponse.json({ error: out.error, candidates: out.candidates }, { status: 409 });
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  const { id } = await params;
  await pool.query('DELETE FROM sales_leads WHERE id = $1', [id]);
  return NextResponse.json({ deleted: true });
}
