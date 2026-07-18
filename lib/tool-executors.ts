import Anthropic from '@anthropic-ai/sdk';
import pool from './db';
import { sendTelegramMessage, formatBoardReviewMessage } from './telegram';
import { sendEmail } from './email';
import { getMissingFields, getGate, GRANT_MONEY_FIELDS } from './gates';
import { executeProspectTool, PROSPECT_TOOL_NAMES } from './prospect-executors';
import { appendMemory, removeMemory } from './memory';
import { MODEL, webSearchTool } from './llm';
import { markDealLost, type RootCause } from './lessons';

const anthropic = new Anthropic();

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

  // Load deal data for structured board review message
  const { rows: dealRows } = await pool.query(
    `SELECT d.name, d.company, d.value, d.currency, d.score, d.risk, d.verdict, d.gate,
            u.name as lead_name
     FROM deals d LEFT JOIN users u ON u.id = d.lead_id
     WHERE d.id = $1`,
    [deal_id]
  );

  let formattedMessage: string;
  if (dealRows[0]) {
    formattedMessage = formatBoardReviewMessage(dealRows[0], message);
  } else {
    formattedMessage = message;
  }

  const { messageId } = await sendTelegramMessage(formattedMessage);

  // Store board decision record with multi-vote tracking
  await pool.query(
    `INSERT INTO board_decisions (deal_id, gate, telegram_message_id, question, status, votes_required, votes_to_block, total_voters)
     VALUES ($1, $2, $3, $4, 'pending', 5, 4, 8)`,
    [deal_id, gate, messageId, message]
  );

  // Set flag to prevent duplicate sends
  const flag = `board_sent_g${gate}`;
  await pool.query(
    `UPDATE deals SET flags = array_append(flags, $1) WHERE id = $2 AND NOT ($1 = ANY(flags))`,
    [flag, deal_id]
  );

  return { success: true, telegram_message_id: messageId, gate, flag_set: flag, votes_required: 5 };
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
  'gate', 'score', 'risk', 'verdict', 'notes', 'value', 'currency', 'owner', 'lead_id',
]);

export async function exec_update_deal(input: {
  deal_id: string;
  updates: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const { deal_id, updates } = input;
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  // Track gate change for audit + load deal_type/fields for grant guard.
  // Also track the OLD lead_id so we can push a "you've been assigned"
  // notification to the new lead over Telegram if it changes.
  let oldGate: number | null = null;
  let dealType: string | null = null;
  let currentFields: Record<string, unknown> = {};
  let oldLeadId: string | null = null;
  if (updates.gate !== undefined || updates.lead_id !== undefined) {
    const { rows } = await pool.query(
      'SELECT gate, deal_type, fields, lead_id FROM deals WHERE id = $1',
      [deal_id]
    );
    if (rows[0]) {
      oldGate = rows[0].gate;
      dealType = rows[0].deal_type;
      currentFields = (rows[0].fields as Record<string, unknown>) || {};
      oldLeadId = rows[0].lead_id ?? null;
    }
  }

  // ─── HARD BLOCK: grant gate advancement requires all money fields ──
  // Fields included in THIS update are merged onto current fields for the
  // check, so the AI can advance + fill money in a single call if it sets
  // both `gate` and `fields` together.
  if (
    dealType === 'grant' &&
    updates.gate !== undefined &&
    oldGate !== null &&
    Number(updates.gate) > oldGate
  ) {
    const incomingFields =
      typeof updates.fields === 'object' && updates.fields !== null
        ? (updates.fields as Record<string, unknown>)
        : {};
    const mergedFields = { ...currentFields, ...incomingFields };
    const missingMoney = GRANT_MONEY_FIELDS.filter((f) => {
      const v = mergedFields[f];
      return v === undefined || v === null || v === '';
    });
    if (missingMoney.length > 0) {
      return {
        error: `BLOCKED: cannot advance grant from G${oldGate} to G${updates.gate} — money fields missing: ${missingMoney.join(', ')}. Ask the user to provide them and call update_deal again with both the new gate AND a fields object containing the values.`,
        blocked: true,
        missing_money_fields: missingMoney,
      };
    }
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

    // If the deal advanced forward, close any pending board_decisions that
    // are now stale (same deal, gate < new gate). Prevents the "graveyard"
    // pattern where a fresh board review supersedes an earlier stalled one
    // but the old row stays pending forever. Idempotent — noop if nothing
    // matches.
    if ((updates.gate as number) > oldGate) {
      await pool.query(
        `UPDATE board_decisions
         SET status = 'superseded',
             resolved_at = COALESCE(resolved_at, now())
         WHERE deal_id = $1 AND status = 'pending' AND gate < $2`,
        [deal_id, updates.gate],
      );
    }

    // Send Telegram notification for board gate completions and significant advances
    const newGate = updates.gate as number;
    // Sales board gates: G3 → G4 (Review Board 1) and G7 → G8 (Review Board 2).
    // Was G5 → G6 prior to the board review move; G5 is now Internal Sign-off.
    const isBoardPass = (oldGate === 3 && newGate === 4) || (oldGate === 7 && newGate === 8);
    const isWon = newGate === 9;

    if (isBoardPass || isWon) {
      const dealName = deal?.name || 'Unknown deal';
      const dealCompany = deal?.company || '';
      let notifText = '';

      if (isWon) {
        notifText = `DEAL WON: "${dealName}" (${dealCompany}) has reached G9 — Project Handover! Congratulations to the team.`;
      } else {
        const boardGate = oldGate;
        notifText = `BOARD APPROVED: "${dealName}" (${dealCompany}) passed Review Board G${boardGate} and advanced to G${newGate}. Deal score: ${deal?.score ?? 'N/A'}.`;
      }

      try {
        await sendTelegramMessage(notifText);
      } catch (err) {
        console.error('[Telegram] Failed to send gate advance notification:', err);
      }
    }

    // ─── Auto-create the post-G9 client onboarding ───────────────────
    // When a sales deal hits G9 (Project Handover), spin up an onboarding
    // row so the internal team can take it through the 8-stage workflow.
    // Idempotent via the UNIQUE constraint on client_onboardings.deal_id.
    
    if (isWon && deal?.deal_type === 'sales') {
      try {
        const { rows: existingOnb } = await pool.query(
          'SELECT id FROM client_onboardings WHERE deal_id = $1', [deal_id]
        );
        if (existingOnb.length === 0) {
          // Pull as much as we can from the deal's captured fields. Single
          // helper keeps this in sync with the manual-create endpoint.
          const { prefillFromDeal } = await import('./onboarding');
          const pf = prefillFromDeal({
            company: deal.company as string,
            contact_email: (deal.contact_email as string | null) ?? null,
            notes: (deal.notes as string | null) ?? null,
            fields: (deal.fields as Record<string, unknown> | null) ?? null,
          });
          const { rows: insertedRows } = await pool.query(
            `INSERT INTO client_onboardings
              (deal_id, pm_user_id, company_name, website, company_size, description, deployment_plan, primary_contact_email)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
              deal_id,
              deal.lead_id ?? null,
              pf.company_name,
              pf.website,
              pf.company_size,
              pf.description,
              pf.deployment_plan,
              pf.primary_contact_email,
            ]
          );
          const onboardingId = insertedRows[0]?.id as string | undefined;

          // Fire the welcome email to the deal's contact_email. Best-effort —
          // the deal advance to G9 must still succeed even if Resend is down.
          if (onboardingId) {
            const { sendOnboardingKickoffEmail } = await import('./onboarding-server');
            // Look up the PM info if any — used as the personal sign-off.
            let pmName: string | null = null;
            let pmEmail: string | null = null;
            if (deal.lead_id) {
              try {
                const { rows: pmRows } = await pool.query(
                  'SELECT name, email FROM users WHERE id = $1', [deal.lead_id]
                );
                pmName = pmRows[0]?.name ?? null;
                pmEmail = pmRows[0]?.email ?? null;
              } catch { /* non-fatal */ }
            }
            await sendOnboardingKickoffEmail({
              onboardingId,
              companyName: deal.company as string,
              recipient: (deal.contact_email as string | null) ?? null,
              pmName,
              pmEmail,
            });
          }
        }
      } catch (err) {
        // Don't fail the deal advance if onboarding creation hiccups —
        // the user can manually create one from /onboarding.
        console.error('[onboarding auto-create] Failed for deal', deal_id, err);
      }
    }
  }

  // Recalculate missing fields
  if (deal) {
    const missing = getMissingFields(deal.gate, deal.fields || {});
    if (missing.length !== (deal.missing?.length || 0)) {
      await pool.query('UPDATE deals SET missing = $1 WHERE id = $2', [missing, deal_id]);
      deal.missing = missing;
    }
  }

  // Fire-and-forget: notify the new lead over Telegram if the assignment
  // changed. Only fires when lead_id was in the update AND actually changed.
  if (
    updates.lead_id !== undefined &&
    deal?.lead_id &&
    deal.lead_id !== oldLeadId
  ) {
    (async () => {
      try {
        const { notifyDealAssigned } = await import('./telegram-notifications');
        const { getGate } = await import('./gates');
        const gate = getGate(deal.gate, deal.deal_type ?? 'sales');
        await notifyDealAssigned(deal.lead_id, {
          id: deal.id,
          name: deal.name,
          company: deal.company,
          gate: deal.gate,
          gate_name: gate?.name ?? null,
          score: deal.score,
          risk: deal.risk,
        });
      } catch (err) {
        console.warn('[exec_update_deal] telegram assignment notification failed:', err);
      }
    })();
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

// ─── prep_meeting ──────────────────────────────────────────────

export async function exec_prep_meeting(input: {
  deal_id: string;
  meeting_type: string;
  attendees?: string;
  focus_areas?: string[];
}): Promise<Record<string, unknown>> {
  const { deal_id, meeting_type, attendees, focus_areas } = input;

  // Load full deal context
  const [dealRes, convoRes, gateRes, boardRes, followupRes] = await Promise.all([
    pool.query(
      `SELECT d.*, u.name as lead_name, u.email as lead_email
       FROM deals d LEFT JOIN users u ON u.id = d.lead_id
       WHERE d.id = $1`,
      [deal_id]
    ),
    pool.query(
      `SELECT role, content, created_at FROM conversations
       WHERE deal_id = $1 AND role IN ('user', 'assistant')
       ORDER BY created_at DESC LIMIT 50`,
      [deal_id]
    ),
    pool.query(
      `SELECT from_gate, to_gate, reason, created_at FROM gate_events
       WHERE deal_id = $1 ORDER BY created_at DESC`,
      [deal_id]
    ),
    pool.query(
      `SELECT gate, question, decision, decided_by, decided_at FROM board_decisions
       WHERE deal_id = $1 ORDER BY created_at DESC`,
      [deal_id]
    ),
    pool.query(
      `SELECT type, subject, body, due_at, sent, sent_at FROM followups
       WHERE deal_id = $1 ORDER BY due_at DESC LIMIT 20`,
      [deal_id]
    ),
  ]);

  const deal = dealRes.rows[0];
  if (!deal) return { error: 'Deal not found' };

  const context = {
    deal: {
      name: deal.name,
      company: deal.company,
      gate: deal.gate,
      score: deal.score,
      risk: deal.risk,
      verdict: deal.verdict,
      value: deal.value,
      currency: deal.currency,
      contact_name: deal.contact_name,
      contact_email: deal.contact_email,
      lead_name: deal.lead_name,
      fields: deal.fields,
      missing: deal.missing,
      flags: deal.flags,
      notes: deal.notes ? (deal.notes as string).slice(0, 500) : null,
    },
    conversation_highlights: convoRes.rows.slice(0, 20).map((r) => ({
      role: r.role,
      content: (r.content as string).slice(0, 200),
      date: r.created_at,
    })),
    gate_history: gateRes.rows,
    board_decisions: boardRes.rows,
    followups: followupRes.rows.slice(0, 10),
    meeting_type,
    attendees: attendees || 'Not specified',
    focus_areas: focus_areas || [],
  };

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    // Web search lets the briefing pull live context — recent press on the
    // client, public news about attendees' companies, donor announcements —
    // that's almost always more useful than guessing from training data.
    tools: [webSearchTool],
    system: `You are a meeting prep specialist for B2B sales. The company sells Zeami — a work intelligence and automation readiness platform. Generate a structured, actionable briefing. Use markdown formatting.

You have access to a \`web_search\` tool. Use it sparingly to pull live facts the deal context doesn't already give you — e.g. recent company news, leadership changes, donor announcements, market events. Cite source URLs inline. Don't search for things already in the deal data.

Include these sections:

## Executive Summary
One paragraph — what this deal is about and where it stands.

## Deal Timeline
Key milestones and gate progression.

## Current Status & Gaps
What's been done, what's missing, what's at risk.

## Talking Points
3-5 specific points to raise in this ${meeting_type} meeting.

## Potential Objections & Responses
Anticipate 2-3 likely pushbacks and prepare responses.

## Recommended Asks
What to request from the client in this meeting.

Be specific — reference actual data from the deal, not generic advice.`,
    messages: [{
      role: 'user',
      content: `Generate a ${meeting_type} prep briefing:\n\n${JSON.stringify(context, null, 2)}`,
    }],
  });

  const briefingText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  return {
    briefing: briefingText,
    deal_name: deal.name,
    meeting_type,
    generated_at: new Date().toISOString(),
  };
}

// ─── remember / forget ─────────────────────────────────────────

export async function exec_remember(
  input: { scope: 'org' | 'user'; fact: string },
  ctx: { userEmail?: string; dealId?: string }
): Promise<Record<string, unknown>> {
  if (input.scope === 'user' && !ctx.userEmail) {
    return { error: 'Cannot save a user-scoped memory: no user context (this likely fired from a cron/webhook). Use scope="org" instead.' };
  }
  try {
    const memId = await appendMemory(input.scope, input.fact, {
      userEmail: ctx.userEmail,
      byEmail: ctx.userEmail,
      sourceDealId: ctx.dealId,
    });
    return { saved: true, mem_id: memId, scope: input.scope, fact: input.fact };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'remember failed' };
  }
}

export async function exec_forget(
  input: { mem_id: string },
  ctx: { userEmail?: string }
): Promise<Record<string, unknown>> {
  try {
    const result = await removeMemory(input.mem_id, { userEmail: ctx.userEmail, byEmail: ctx.userEmail });
    if (!result.removed) {
      return { removed: false, error: `No memory found with id ${input.mem_id}` };
    }
    return { removed: true, scope: result.scope };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'forget failed' };
  }
}

// ─── mark_deal_lost ────────────────────────────────────────────

export async function exec_mark_deal_lost(
  input: {
    deal_id: string;
    reason: string;
    root_cause: RootCause;
    competitor?: string;
    lesson: string;
  },
  ctx: { userId?: string }
): Promise<Record<string, unknown>> {
  if (!ctx.userId) {
    return { error: 'mark_deal_lost requires a signed-in user context (no userId on call).' };
  }
  try {
    const result = await markDealLost({
      dealId: input.deal_id,
      byUserId: ctx.userId,
      byTriggeredBy: 'agent',
      input: {
        reason: input.reason,
        root_cause: input.root_cause,
        competitor: input.competitor || null,
        lesson: input.lesson,
      },
    });
    if (result.status === 'already_lost') {
      return { already_lost: true, deal_id: input.deal_id, message: 'Deal was already marked lost; no new lesson recorded.' };
    }
    return {
      marked_lost: true,
      deal_id: input.deal_id,
      lesson_id: result.lesson_id,
      message: `Deal flipped to status='lost', lesson recorded (root_cause=${input.root_cause}). View at /lessons.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'mark_deal_lost failed' };
  }
}

// ─── Dispatcher ─────────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  context?: { userId?: string; userEmail?: string; dealId?: string }
): Promise<Record<string, unknown>> {
  // Route prospecting tools to the prospect-executors module
  if (PROSPECT_TOOL_NAMES.has(name)) {
    return executeProspectTool(name, input, context);
  }

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
    case 'prep_meeting':
      return exec_prep_meeting(input as Parameters<typeof exec_prep_meeting>[0]);
    case 'remember':
      return exec_remember(
        input as Parameters<typeof exec_remember>[0],
        { userEmail: context?.userEmail, dealId: context?.dealId }
      );
    case 'forget':
      return exec_forget(
        input as Parameters<typeof exec_forget>[0],
        { userEmail: context?.userEmail }
      );
    case 'mark_deal_lost':
      return exec_mark_deal_lost(
        input as Parameters<typeof exec_mark_deal_lost>[0],
        { userId: context?.userId }
      );
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
