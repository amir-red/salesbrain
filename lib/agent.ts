import Anthropic from '@anthropic-ai/sdk';
import pool from './db';
import { TOOLS } from './tools';
import { executeTool } from './tool-executors';
import { GATES, getGate, getMissingFields, getSLAStatus } from './gates';

const anthropic = new Anthropic();

const MAX_ITERATIONS = 6;

// ─── System Prompt Builder ──────────────────────────────────────

export function buildSystemPrompt(deal: Record<string, unknown> | null): string {
  const base = `You are SalesBrain — a direct, opinionated, senior B2B sales strategist and CRM intelligence engine.

## Our Solution — Mate (ALWAYS use this context when discussing our offering)

Mate is a **work intelligence and automation readiness platform** for organizations running significant computer-based work (knowledge work, back-office, operations, creative and analytical roles).

**What it does (observe → understand → prioritize → assist):**
1. **Ground-truth visibility** — Captures how work actually happens on desktops (organization-controlled, respectful), replacing guesswork with real data.
2. **Process understanding** — Turns raw activity into named workflows with intent and steps, shifting conversations from "everyone is busy" to "here are the recurring jobs and how they flow."
3. **Efficiency & opportunity insight** — Classifies where work is heavy, repetitive, error-prone, or fragmented so improvement and automation can be prioritized with evidence.
4. **Assistive automation** — AI-powered helpers grounded in real workflows, so employees get copilot-style support matching how they actually work.

**Key value propositions:**
- Faster, cheaper process discovery (weeks of interviews replaced by continuous structured insight)
- Higher-quality automation backlog ranked by real frequency, pain, and fit
- Aligned improvement across business, IT, and employees
- Measurable follow-through linking insight to pilots with clear before/after
- Employee-centric enablement reflecting actual work patterns

**Who benefits:** Executives/ops leaders (fact-based picture), transformation/COE teams (discovery-to-ranked pipeline), people managers (bottleneck visibility), employees (less guesswork + aligned assistants), IT/risk (organization-owned data boundaries).

**What Mate is NOT:** Not surveillance (value story is operational clarity), not a replacement for human judgment, not automation-without-understanding.

**Elevator pitch:** Mate turns desktop work into structured workflows and clear improvement signals. Organizations gain an evidence-based view of how work flows, where it slows down, and what's worth automating — then connect that insight to practical AI assistance for employees.

When discussing deals, ALWAYS frame our solution in terms of the client's specific pain points and how Mate addresses them. Be specific about which Mate capabilities map to their needs.

## Your personality
- You are sharp, decisive, and challenge lazy thinking.
- "They seem interested" is not data. Push for specifics.
- When the user gives you a brain-dump (meeting notes, call summary, email thread, or multi-topic message), extract EVERY relevant field you can in a single pass. Call update_deal once with all extracted fields. Then list what you extracted and challenge anything that sounds vague or weak.
- Only ask follow-up questions for fields that are still genuinely missing or where the user's input was too vague to score. Group remaining questions — ask about 2-3 related fields in one message, never one at a time.
- If the user gives a short or single-topic answer, respond naturally to that topic. Don't force bulk mode on simple exchanges.
- Act autonomously — send Telegram messages for board gates without being asked.
- Give clear verdicts: STRONG / PROCEED_WITH_CAUTION / WEAK / WALK_AWAY.
- Flag SLA breaches immediately and call them out directly.
- You don't sugarcoat. Bad deals get told they're bad deals.

## The 9-Gate Pipeline
${GATES.map((g) => `G${g.number}: ${g.name} (${g.slaDays}d SLA${g.isBoard ? ', BOARD GATE' : ''}${g.requiredFields ? `, requires: ${g.requiredFields.join(', ')}` : ''})`).join('\n')}

## Rules
- When a deal reaches a board gate (G3, G5), automatically send a Telegram message to the review board using the send_telegram tool. Don't wait to be asked.
- When all required fields for G2 are filled, assess the deal and recommend advancing.
- When updating deal data, always use update_deal to persist changes.
- After any significant update, run assess_deal to recalculate score/risk.
- When scheduling followups, be specific about content and timing.
- When the user mentions an upcoming meeting, call, demo, or presentation with the client, automatically call prep_meeting to generate a briefing. Don't wait to be asked for meeting prep.
- For concept drafts (G4+), produce thorough, structured documents.`;

  if (!deal) {
    return base + '\n\nNo deal is currently selected. Help the user create or select a deal.';
  }

  const gate = getGate(deal.gate as number);
  const sla = getSLAStatus(deal.gate as number, new Date(deal.gate_entered_at as string));
  const missing = getMissingFields(deal.gate as number, (deal.fields as Record<string, unknown>) || {});

  return `${base}

## Current Deal State
- **Deal**: ${deal.name} (${deal.company})
- **ID**: ${deal.id}
- **Gate**: G${deal.gate} — ${gate?.name || 'Unknown'}
- **Days in gate**: ${sla.daysInGate} / ${sla.slaDays}d SLA → ${sla.status.toUpperCase()}${sla.status === 'breached' ? ' ⚠️ SLA BREACHED — address this immediately!' : sla.status === 'warning' ? ' ⚡ SLA warning — approaching deadline' : ''}
- **Score**: ${deal.score ?? 'Not assessed'}
- **Risk**: ${deal.risk ?? 'Not assessed'}
- **Verdict**: ${deal.verdict ?? 'Not assessed'}
- **Value**: ${deal.value ? `${deal.currency || 'USD'} ${deal.value}` : 'Unknown'}
- **Contact**: ${deal.contact_name || 'Unknown'} (${deal.contact_email || 'no email'})
- **Project Lead**: ${deal.lead_name || 'Unassigned'}${deal.lead_email ? ` (${deal.lead_email})` : ''}
- **Owner**: ${deal.owner || 'Unassigned'}
- **Missing fields**: ${missing.length > 0 ? missing.join(', ') : 'None'}
- **Flags**: ${(deal.flags as string[])?.length > 0 ? (deal.flags as string[]).join(', ') : 'None'}
- **Fields data**: ${JSON.stringify(deal.fields || {})}
${deal.notes ? `- **Notes**: ${(deal.notes as string).slice(0, 500)}` : ''}

## What you should do right now
${sla.status === 'breached' ? '1. IMMEDIATELY flag the SLA breach and suggest action.' : ''}
${missing.length > 3
  ? `1. There are ${missing.length} missing fields: **${missing.join(', ')}**. Invite the user to brain-dump everything they know — meeting notes, call summaries, emails. Extract all fields you can from their response in one pass using update_deal, then follow up only on what's still missing.`
  : missing.length > 0
    ? `1. These fields are still missing: **${missing.join(', ')}**. Ask about all of them in a single grouped question.`
    : ''}
${gate?.isBoard && !(deal.flags as string[])?.includes(`board_sent_g${deal.gate}`) ? `1. This is a BOARD GATE. Send Telegram review request immediately.` : ''}`;
}

// ─── Load Conversation History ──────────────────────────────────

export async function loadHistory(dealId: string): Promise<Anthropic.MessageParam[]> {
  const { rows } = await pool.query(
    `SELECT role, content, tool_name, tool_input
     FROM conversations
     WHERE deal_id = $1
     ORDER BY created_at DESC
     LIMIT 60`,
    [dealId]
  );

  // Phase 1: Reconstruct Anthropic message format from flat DB rows
  const ordered = rows.reverse();
  const rawMessages: Anthropic.MessageParam[] = [];
  let toolIdCounter = 0;
  const pendingToolIds: string[] = [];

  for (const row of ordered) {
    if (row.role === 'user') {
      rawMessages.push({ role: 'user', content: row.content });
    } else if (row.role === 'assistant') {
      rawMessages.push({ role: 'assistant', content: row.content });
    } else if (row.role === 'tool_use') {
      toolIdCounter++;
      const toolId = `hist_${toolIdCounter}`;
      pendingToolIds.push(toolId);

      let lastMsg = rawMessages[rawMessages.length - 1];
      if (!lastMsg || lastMsg.role !== 'assistant') {
        lastMsg = { role: 'assistant', content: [] };
        rawMessages.push(lastMsg);
      }
      const content = Array.isArray(lastMsg.content)
        ? lastMsg.content
        : [{ type: 'text' as const, text: lastMsg.content as string }];
      content.push({
        type: 'tool_use' as const,
        id: toolId,
        name: row.tool_name!,
        input: row.tool_input || {},
      });
      lastMsg.content = content;
    } else if (row.role === 'tool_result') {
      const toolId = pendingToolIds.shift();
      if (!toolId) continue;

      const resultBlock = {
        type: 'tool_result' as const,
        tool_use_id: toolId,
        content: row.content,
      };

      const lastMsg = rawMessages[rawMessages.length - 1];
      if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
        (lastMsg.content as Anthropic.ToolResultBlockParam[]).push(resultBlock);
      } else {
        rawMessages.push({ role: 'user', content: [resultBlock] });
      }
    }
  }

  // Phase 2: Validate tool_use/tool_result pairing
  // Every assistant message with tool_use blocks must be followed by
  // a user message containing ALL matching tool_result blocks.
  // If a pair is broken, SKIP it (don't truncate — keep valid messages after it).
  const validated: Anthropic.MessageParam[] = [];
  let i = 0;
  while (i < rawMessages.length) {
    const msg = rawMessages[i];

    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const toolUseIds = (msg.content as Array<{ type: string; id?: string }>)
        .filter((b) => b.type === 'tool_use' && b.id)
        .map((b) => b.id!);

      if (toolUseIds.length > 0) {
        const next = rawMessages[i + 1];

        // Check if next message has matching tool_results
        let pairValid = false;
        if (next && next.role === 'user' && Array.isArray(next.content)) {
          const resultIds = new Set(
            (next.content as Array<{ type?: string; tool_use_id?: string }>)
              .filter((b) => b.type === 'tool_result' && b.tool_use_id)
              .map((b) => b.tool_use_id!)
          );
          pairValid = toolUseIds.every((id) => resultIds.has(id));
        }

        if (pairValid) {
          // Valid pair: keep both
          validated.push(msg);
          validated.push(next!);
          i += 2;
        } else {
          // Broken pair: strip tool_use blocks, keep text-only assistant message
          const textBlocks = (msg.content as Array<{ type: string; text?: string }>)
            .filter((b) => b.type === 'text' && b.text);
          if (textBlocks.length > 0) {
            const textOnly = textBlocks.map((b) => b.text).join('');
            validated.push({ role: 'assistant', content: textOnly });
          }
          // Skip the orphaned tool_result message too if it exists
          if (next && next.role === 'user' && Array.isArray(next.content)) {
            i += 2;
          } else {
            i += 1;
          }
        }
        continue;
      }
    }

    validated.push(msg);
    i++;
  }

  // Phase 3: Ensure strict role alternation (user/assistant/user/assistant)
  const final: Anthropic.MessageParam[] = [];
  for (const msg of validated) {
    if (final.length > 0 && final[final.length - 1].role === msg.role) {
      // Consecutive same-role: keep the newer one
      final.pop();
    }
    final.push(msg);
  }

  // Ensure first message is 'user' (API requirement)
  while (final.length > 0 && final[0].role !== 'user') {
    final.shift();
  }

  return final;
}

// ─── Persist Message ────────────────────────────────────────────

async function persistMessage(
  dealId: string,
  role: string,
  content: string,
  toolName?: string,
  toolInput?: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `INSERT INTO conversations (deal_id, role, content, tool_name, tool_input)
     VALUES ($1, $2, $3, $4, $5)`,
    [dealId, role, content, toolName || null, toolInput ? JSON.stringify(toolInput) : null]
  );
}

// ─── Stream Event Types ─────────────────────────────────────────

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; tool: string; tool_input: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; tool_output: Record<string, unknown> }
  | { type: 'done' }
  | { type: 'error'; error: string };

// ─── Agentic Loop ───────────────────────────────────────────────

export async function* runAgent(
  dealId: string,
  userMessage: string,
  userId?: string
): AsyncGenerator<StreamEvent> {
  // Load deal (scoped to user if userId provided)
  const dealQuery = userId
    ? `SELECT d.*, u.name as lead_name, u.email as lead_email
       FROM deals d LEFT JOIN users u ON u.id = d.lead_id
       WHERE d.id = $1 AND d.user_id = $2`
    : `SELECT d.*, u.name as lead_name, u.email as lead_email
       FROM deals d LEFT JOIN users u ON u.id = d.lead_id
       WHERE d.id = $1`;
  const dealParams = userId ? [dealId, userId] : [dealId];
  const { rows: dealRows } = await pool.query(dealQuery, dealParams);
  const deal = dealRows[0] || null;

  if (!deal) {
    yield { type: 'error', error: 'Deal not found' };
    return;
  }

  // Load history BEFORE persisting new message (avoids duplicate/ordering issues)
  const history = await loadHistory(dealId);

  // Build messages array with proper role alternation
  const messages: Anthropic.MessageParam[] = [...history];

  // If history ends with a user message, we can't append another user message
  // (Anthropic API requires strict user/assistant alternation)
  if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
    // Drop the trailing user message — the new one replaces it
    messages.pop();
  }

  // Append the new user message
  messages.push({ role: 'user', content: userMessage });

  // Persist after building the array
  await persistMessage(dealId, 'user', userMessage);

  const systemPrompt = buildSystemPrompt(deal);

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    // Process response content
    const assistantContent = response.content;
    let fullText = '';

    for (const block of assistantContent) {
      if (block.type === 'text') {
        fullText += block.text;
        yield { type: 'text', text: block.text };
      }
    }

    // Persist assistant text
    if (fullText) {
      await persistMessage(dealId, 'assistant', fullText);
    }

    // Check for tool use
    const toolUseBlocks = assistantContent.filter((b) => b.type === 'tool_use');

    if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
      yield { type: 'done' };
      return;
    }

    // Execute all tool calls in parallel
    messages.push({ role: 'assistant', content: assistantContent });

    // Emit tool_start events first
    const toolUseCasts = toolUseBlocks.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    for (const block of toolUseCasts) {
      yield { type: 'tool_start', tool: block.name, tool_input: block.input as Record<string, unknown> };
    }

    const toolMeta: { tool: string; output: Record<string, unknown> }[] = [];
    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUseCasts.map(async (block) => {
        const toolInput = block.input as Record<string, unknown>;

        // Persist tool use
        await persistMessage(dealId, 'tool_use', block.name, block.name, toolInput);

        let result: Record<string, unknown>;
        try {
          result = await executeTool(block.name, toolInput);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : 'Tool execution failed' };
        }

        // Persist tool result
        await persistMessage(dealId, 'tool_result', JSON.stringify(result), block.name);

        toolMeta.push({ tool: block.name, output: result });

        return {
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: JSON.stringify(result),
        };
      })
    );

    // Emit tool_result events
    for (const meta of toolMeta) {
      yield { type: 'tool_result', tool: meta.tool, tool_output: meta.output };
    }

    messages.push({ role: 'user', content: toolResults });
  }

  yield { type: 'text', text: '\n\n⚠️ Reached maximum iteration limit. Please continue the conversation.' };
  yield { type: 'done' };
}
