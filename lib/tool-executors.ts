import pool from './db';
import { sendTelegramMessage } from './telegram';
import { sendEmail } from './email';
import { getMissingFields, getGate } from './gates';

// ─── assess_deal ────────────────────────────────────────────────

export async function exec_assess_deal(input: {
  deal_id: string;
  reasoning: string;
  score: number;
  risk: string;
  verdict: string;
  risk_signals: string[];
}): Promise<Record<string, unknown>> {
  const { deal_id, score, risk, verdict, risk_signals, reasoning } = input;

  await pool.query(
    `UPDATE deals SET score = $1, risk = $2, verdict = $3,
     flags = array_cat(flags, $4::text[])
     WHERE id = $5`,
    [score, risk, verdict, risk_signals, deal_id]
  );

  const { rows } = await pool.query('SELECT * FROM deals WHERE id = $1', [deal_id]);
  const deal = rows[0];

  return {
    deal_id,
    score,
    risk,
    verdict,
    risk_signals,
    reasoning,
    gate: deal?.gate,
    missing_fields: deal ? getMissingFields(deal.gate, deal.fields || {}) : [],
  };
}

// ─── send_telegram ──────────────────────────────────────────────

export async function exec_send_telegram(input: {
  deal_id: string;
  message: string;
  gate: number;
}): Promise<Record<string, unknown>> {
  const { deal_id, message, gate } = input;

  const { messageId } = await sendTelegramMessage(message);

  // Store board decision record
  await pool.query(
    `INSERT INTO board_decisions (deal_id, gate, telegram_message_id, question)
     VALUES ($1, $2, $3, $4)`,
    [deal_id, gate, messageId, message]
  );

  // Set flag to prevent duplicate sends
  const flag = `board_sent_g${gate}`;
  await pool.query(
    `UPDATE deals SET flags = array_append(flags, $1) WHERE id = $2 AND NOT ($1 = ANY(flags))`,
    [flag, deal_id]
  );

  return { success: true, telegram_message_id: messageId, gate, flag_set: flag };
}

// ─── send_email ─────────────────────────────────────────────────

export async function exec_send_email(input: {
  deal_id: string;
  to: string;
  subject: string;
  body: string;
  send_immediately: boolean;
}): Promise<Record<string, unknown>> {
  const { deal_id, to, subject, body, send_immediately } = input;

  if (send_immediately) {
    const { id } = await sendEmail({ to, subject, body });
    return { sent: true, email_id: id };
  }

  const { rows } = await pool.query(
    `INSERT INTO followups (deal_id, type, subject, body, to_email, due_at)
     VALUES ($1, 'email', $2, $3, $4, now())
     RETURNING id`,
    [deal_id, subject, body, to]
  );

  return { drafted: true, followup_id: rows[0].id };
}

// ─── update_deal ────────────────────────────────────────────────

const DIRECT_COLUMNS = new Set([
  'name', 'company', 'contact_name', 'contact_email', 'contact_phone',
  'gate', 'score', 'risk', 'verdict', 'notes', 'value', 'currency', 'owner',
]);

export async function exec_update_deal(input: {
  deal_id: string;
  updates: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const { deal_id, updates } = input;
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  // Track gate change for audit
  let oldGate: number | null = null;
  if (updates.gate !== undefined) {
    const { rows } = await pool.query('SELECT gate FROM deals WHERE id = $1', [deal_id]);
    if (rows[0]) oldGate = rows[0].gate;
  }

  for (const [key, val] of Object.entries(updates)) {
    if (key === 'fields' && typeof val === 'object' && val !== null) {
      setClauses.push(`fields = fields || $${paramIdx}::jsonb`);
      values.push(JSON.stringify(val));
      paramIdx++;
    } else if (key === 'missing') {
      setClauses.push(`missing = $${paramIdx}::text[]`);
      values.push(val);
      paramIdx++;
    } else if (key === 'flags') {
      setClauses.push(`flags = $${paramIdx}::text[]`);
      values.push(val);
      paramIdx++;
    } else if (DIRECT_COLUMNS.has(key)) {
      setClauses.push(`${key} = $${paramIdx}`);
      values.push(val);
      paramIdx++;
    }
  }

  // If gate is advancing, also update gate_entered_at
  if (updates.gate !== undefined && oldGate !== null && (updates.gate as number) > oldGate) {
    setClauses.push(`gate_entered_at = now()`);
  }

  if (setClauses.length === 0) {
    return { updated: false, reason: 'no valid fields to update' };
  }

  values.push(deal_id);
  const query = `UPDATE deals SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`;
  const { rows } = await pool.query(query, values);
  const deal = rows[0];

  // Record gate event if gate changed
  if (updates.gate !== undefined && oldGate !== null && updates.gate !== oldGate) {
    await pool.query(
      `INSERT INTO gate_events (deal_id, from_gate, to_gate, reason, triggered_by)
       VALUES ($1, $2, $3, $4, 'agent')`,
      [deal_id, oldGate, updates.gate, updates.notes || `Advanced to gate ${updates.gate}`]
    );
  }

  // Recalculate missing fields
  if (deal) {
    const missing = getMissingFields(deal.gate, deal.fields || {});
    if (missing.length !== (deal.missing?.length || 0)) {
      await pool.query('UPDATE deals SET missing = $1 WHERE id = $2', [missing, deal_id]);
      deal.missing = missing;
    }
  }

  return { updated: true, deal };
}

// ─── schedule_followup ──────────────────────────────────────────

export async function exec_schedule_followup(input: {
  deal_id: string;
  type: string;
  subject?: string;
  body: string;
  to_email?: string;
  due_in_days: number;
}): Promise<Record<string, unknown>> {
  const { deal_id, type, subject, body, to_email, due_in_days } = input;

  const { rows } = await pool.query(
    `INSERT INTO followups (deal_id, type, subject, body, to_email, due_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '1 day' * $6)
     RETURNING id, due_at`,
    [deal_id, type, subject || null, body, to_email || null, due_in_days]
  );

  return { scheduled: true, followup_id: rows[0].id, due_at: rows[0].due_at };
}

// ─── draft_concept ──────────────────────────────────────────────

export async function exec_draft_concept(input: {
  deal_id: string;
  problem: string;
  solution: string;
  pricing_approach: string;
  differentiators: string[];
  risks: string[];
}): Promise<Record<string, unknown>> {
  const { deal_id, problem, solution, pricing_approach, differentiators, risks } = input;

  const concept = {
    deal_id,
    generated_at: new Date().toISOString(),
    sections: {
      problem_statement: problem,
      proposed_solution: solution,
      pricing_approach,
      key_differentiators: differentiators,
      risks_and_mitigations: risks,
    },
  };

  // Store concept in deal notes as a record
  await pool.query(
    `UPDATE deals SET notes = COALESCE(notes, '') || E'\n\n--- CONCEPT DRAFT ---\n' || $1 WHERE id = $2`,
    [JSON.stringify(concept.sections, null, 2), deal_id]
  );

  return concept;
}

// ─── Dispatcher ─────────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'assess_deal':
      return exec_assess_deal(input as Parameters<typeof exec_assess_deal>[0]);
    case 'send_telegram':
      return exec_send_telegram(input as Parameters<typeof exec_send_telegram>[0]);
    case 'send_email':
      return exec_send_email(input as Parameters<typeof exec_send_email>[0]);
    case 'update_deal':
      return exec_update_deal(input as Parameters<typeof exec_update_deal>[0]);
    case 'schedule_followup':
      return exec_schedule_followup(input as Parameters<typeof exec_schedule_followup>[0]);
    case 'draft_concept':
      return exec_draft_concept(input as Parameters<typeof exec_draft_concept>[0]);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
