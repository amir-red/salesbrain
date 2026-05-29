/**
 * POST /api/deals/:id/mark-lost
 *
 * Body: { reason, root_cause, competitor?, lesson }
 *
 * Marks a deal lost AND captures the structured lesson in one atomic
 * transaction. Permissions: deal creator (user_id), assigned lead, or
 * admin — same visibility model as deal chat / detail editing.
 *
 * Idempotent: re-marking an already-lost deal returns 200 with
 * `already_lost: true` and no new lesson row.
 *
 * The actual transaction logic lives in `lib/lessons.ts:markDealLost`
 * so the agent's `mark_deal_lost` tool can call the same path.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { markDealLost, ROOT_CAUSES } from '@/lib/lessons';

const BodySchema = z.object({
  reason: z.string().trim().min(1).max(4000),
  root_cause: z.enum(ROOT_CAUSES),
  competitor: z.string().trim().max(200).optional().nullable(),
  lesson: z.string().trim().min(1).max(4000),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: dealId } = await params;

  // Permission gate — match the deal-chat rule: admin sees all, others
  // need to be creator OR lead.
  if (session.role !== 'admin') {
    const { rows } = await pool.query(
      `SELECT 1 FROM deals WHERE id = $1 AND (user_id = $2 OR lead_id = $2)`,
      [dealId, session.userId],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Deal not found or not accessible' }, { status: 404 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await markDealLost({
      dealId,
      byUserId: session.userId,
      byTriggeredBy: 'user',
      input: parsed.data,
    });
    if (result.status === 'already_lost') {
      return NextResponse.json({ already_lost: true, deal_id: dealId }, { status: 200 });
    }
    return NextResponse.json(
      { lesson_id: result.lesson_id, deal_id: dealId },
      { status: 201 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to mark lost';
    const status = msg === 'Deal not found' ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
