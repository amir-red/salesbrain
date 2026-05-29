/**
 * Server-only helpers for the Lessons Learned system.
 *
 *  - `markDealLost`: the canonical transaction that flips a deal to
 *    status='lost' AND inserts the captured lesson row in one atomic
 *    operation, plus writes a `gate_events` audit row. Used by both the
 *    HTTP endpoint (`POST /api/deals/:id/mark-lost`) AND the agent tool
 *    (`exec_mark_deal_lost`) so they can't drift.
 *
 *  - `loadRelevantLessons`: pulls the top N past losses that look like
 *    the current deal (same deal_type, similar gate, similar value).
 *    Used at chat-start to inject a "## Lessons from similar past
 *    losses" block into the agent's dynamic system prompt.
 *
 *  - `formatLessonsBlock`: turns the rows into the markdown block.
 */

import pool from './db';

export const ROOT_CAUSES = [
  'price',
  'timeline',
  'fit',
  'decision_maker',
  'capability',
  'competition',
  'budget',
  'eligibility',
  'other',
] as const;

export type RootCause = (typeof ROOT_CAUSES)[number];

export interface MarkLostInput {
  reason: string;
  root_cause: RootCause;
  competitor?: string | null;
  lesson: string;
}

export interface LessonRow {
  id: string;
  deal_id: string;
  deal_type: 'sales' | 'grant';
  gate_lost_at: number;
  value: string | null;          // pg NUMERIC returns as string
  currency: string | null;
  company: string;
  reason: string;
  root_cause: RootCause;
  competitor: string | null;
  lesson: string;
  created_by: string;
  created_at: string;
  // Joined display name when fetched via the list endpoint
  created_by_name?: string | null;
}

/**
 * Atomic "mark deal lost + record lesson" operation.
 *
 * Rules:
 *  - Already-lost deals 409 (idempotency — no duplicate lesson row)
 *  - Stamps verdict='WALK_AWAY' if no verdict was set (so the deal's
 *    summary surfaces "we walked" instead of nothing)
 *  - Writes an audit row to `gate_events` with from_gate=to_gate=current
 *    + a reason snippet starting with "Marked lost:" so existing audit
 *    consumers can recognize this case
 *  - All three writes happen in one transaction; rollback on any failure
 *
 * Throws on validation/auth errors; the caller (route handler or tool
 * executor) decides the HTTP / tool-result shape.
 */
export async function markDealLost(args: {
  dealId: string;
  byUserId: string;
  byTriggeredBy: 'user' | 'agent';
  input: MarkLostInput;
}): Promise<{ status: 'created' | 'already_lost'; lesson_id?: string; deal_id: string }> {
  const { dealId, byUserId, byTriggeredBy, input } = args;

  if (!input.reason?.trim() || !input.lesson?.trim()) {
    throw new Error('reason and lesson are required');
  }
  if (!ROOT_CAUSES.includes(input.root_cause)) {
    throw new Error(`root_cause must be one of: ${ROOT_CAUSES.join(', ')}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the row so a parallel mark-lost can't double-insert.
    const { rows: dealRows } = await client.query(
      `SELECT id, deal_type, gate, value, currency, company, status, verdict
       FROM deals WHERE id = $1 FOR UPDATE`,
      [dealId],
    );
    const deal = dealRows[0];
    if (!deal) {
      await client.query('ROLLBACK');
      throw new Error('Deal not found');
    }
    if (deal.status === 'lost') {
      await client.query('ROLLBACK');
      return { status: 'already_lost', deal_id: dealId };
    }

    const { rows: lessonRows } = await client.query(
      `INSERT INTO lessons_learned
        (deal_id, deal_type, gate_lost_at, value, currency, company,
         reason, root_cause, competitor, lesson, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        dealId,
        deal.deal_type,
        deal.gate,
        deal.value,
        deal.currency,
        deal.company,
        input.reason.trim(),
        input.root_cause,
        input.competitor?.trim() || null,
        input.lesson.trim(),
        byUserId,
      ],
    );
    const lessonId = lessonRows[0].id as string;

    // Flip the deal. Only stamp verdict if it wasn't already set so we
    // don't overwrite e.g. an existing DO_NOT_PURSUE assessment.
    await client.query(
      `UPDATE deals
       SET status = 'lost',
           verdict = COALESCE(verdict, 'WALK_AWAY')
       WHERE id = $1`,
      [dealId],
    );

    // Audit: same-gate event with a recognizable reason prefix.
    await client.query(
      `INSERT INTO gate_events (deal_id, from_gate, to_gate, reason, triggered_by)
       VALUES ($1, $2, $2, $3, $4)`,
      [
        dealId,
        deal.gate,
        `Marked lost: ${input.reason.trim().slice(0, 200)} [root_cause=${input.root_cause}${input.competitor ? `, competitor=${input.competitor}` : ''}]`,
        byTriggeredBy,
      ],
    );

    await client.query('COMMIT');
    return { status: 'created', lesson_id: lessonId, deal_id: dealId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Pull the top 3 most relevant past losses to inject into the agent's
 * system prompt when chatting on a similar deal.
 *
 * Matching:
 *  - same deal_type (sales vs grant — these are completely different motions)
 *  - similar gate (current gate ± 2 — adjacent stages share most pitfalls)
 *  - similar value (within 0.5× to 2× — losses on a $5K grant rarely
 *    inform a $500K one). If either side lacks a value we skip the filter.
 *
 * Excludes the current deal's own lesson if one exists (e.g. someone
 * re-opens chat on a lost deal — don't tell them about their own loss).
 */
export async function loadRelevantLessons(deal: {
  id: string;
  deal_type: 'sales' | 'grant';
  gate: number;
  value: string | number | null;
}): Promise<LessonRow[]> {
  const valueNum = deal.value !== null && deal.value !== undefined ? Number(deal.value) : null;
  const useValueFilter = valueNum !== null && Number.isFinite(valueNum) && valueNum > 0;

  const { rows } = await pool.query<LessonRow>(
    `SELECT l.id, l.deal_id, l.deal_type, l.gate_lost_at, l.value, l.currency,
            l.company, l.reason, l.root_cause, l.competitor, l.lesson,
            l.created_by, l.created_at
     FROM lessons_learned l
     WHERE l.deal_type = $1
       AND l.deal_id <> $2
       AND ABS(l.gate_lost_at - $3) <= 2
       AND (
         $4::numeric IS NULL
         OR l.value IS NULL
         OR (l.value BETWEEN $4 * 0.5 AND $4 * 2.0)
       )
     ORDER BY l.created_at DESC
     LIMIT 3`,
    [deal.deal_type, deal.id, deal.gate, useValueFilter ? valueNum : null],
  );

  return rows;
}

/**
 * Render lessons into the markdown block injected below the memory section
 * in the agent's dynamic system prompt. Returns '' when there's nothing to
 * inject so we don't pollute the prompt with empty sections on fresh installs.
 */
export function formatLessonsBlock(lessons: LessonRow[]): string {
  if (lessons.length === 0) return '';

  const renderOne = (l: LessonRow, idx: number) => {
    const valueStr =
      l.value && Number(l.value) > 0
        ? `${l.currency || 'USD'} ${Math.round(Number(l.value)).toLocaleString()}`
        : 'unknown value';
    const competitorStr = l.competitor ? ` to ${l.competitor}` : '';
    return [
      `${idx + 1}. **${l.company}** — ${l.deal_type === 'grant' ? 'grant' : 'sales deal'} at G${l.gate_lost_at} · ${valueStr} · lost on **${l.root_cause}**${competitorStr}`,
      `   What happened: ${l.reason.replace(/\s+/g, ' ').trim()}`,
      `   Lesson: ${l.lesson.replace(/\s+/g, ' ').trim()}`,
    ].join('\n');
  };

  return [
    '',
    '## Lessons from similar past losses',
    '',
    `We have ${lessons.length} prior loss${lessons.length === 1 ? '' : 'es'} that match this deal's profile (same type, adjacent gate, similar value):`,
    '',
    ...lessons.map(renderOne),
    '',
    'Use these PROACTIVELY: if the current deal is heading toward the same root cause (price pressure, eligibility mismatch, decision-maker missing, etc.), say so directly and name the past company. Don\'t repeat the lesson verbatim — synthesize the warning in context. If the pattern doesn\'t apply, ignore these.',
  ].join('\n');
}
