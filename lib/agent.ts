import Anthropic from '@anthropic-ai/sdk';
import pool from './db';
import { TOOLS } from './tools';
import { executeTool } from './tool-executors';
import { getPipeline, getGate, getMissingFields, getSLAStatus, type DealType } from './gates';

const anthropic = new Anthropic();

const MAX_ITERATIONS = 6;

// ─── System Prompt Builder ──────────────────────────────────────

const MATE_KB = `## Mate (for SALES deals)

Mate is a **work intelligence and automation readiness platform** for organizations running significant computer-based work (knowledge work, back-office, operations, creative and analytical roles).

**What it does (observe → understand → prioritize → assist):**
1. Ground-truth visibility — captures how work actually happens on desktops
2. Process understanding — turns raw activity into named workflows with intent and steps
3. Efficiency & opportunity insight — classifies where work is heavy, repetitive, error-prone, or fragmented
4. Assistive automation — AI-powered helpers grounded in real workflows

**Key value:** Faster process discovery, higher-quality automation backlog, aligned improvement across business/IT/employees, measurable follow-through, employee-centric enablement.

**What Mate is NOT:** Not surveillance, not a replacement for human judgment, not automation-without-understanding.

**Elevator pitch:** Mate turns desktop work into structured workflows and clear improvement signals. Organizations gain evidence-based view of how work flows, where it slows down, and what's worth automating — then connect that insight to practical AI assistance.`;

const CHIPCHIP_KB = `## ChipChip (for GRANT deals)

ChipChip is an Ethiopian **agri-commerce and supply-chain technology platform** connecting farmers and suppliers to urban demand through a three-app ecosystem:
1. Consumer-facing / group-buying demand app
2. Logistics coordination app
3. Seller / stock management app (extendable to farmers and cooperatives)

**Donor-facing narratives (pick based on grant mandate):**
- Affordable food access and urban nutrition
- Farmer income uplift through direct market access
- Digital agricultural supply-chain infrastructure
- Post-harvest loss reduction and logistics efficiency
- Structured off-take and B2B hub commercialization
- Trust, traceability, and export readiness
- Capacity-building plus digital enablement for farmers/cooperatives
- Public-good agricultural data systems

**Traction (approximate):** ~248k registered users, ~128k paying customers, ~2.54M delivered orders, ~4.78M kg traded, >$2.1M GMV. Farmers earn ~20-30% higher prices; consumers see ~25% lower prices than local-market alternatives.

**What ChipChip IS NOT:** Not just a food-delivery app, not just a marketplace without operating capacity, not a traditional NGO, not a generic "AI startup" for donor purposes.

**Positioning for donors:** ChipChip is a private-sector delivery mechanism for public-good outcomes in food systems — a market-linkage and operating infrastructure layer for fresh-food supply chains.

**Strategic alignment scoring for grants (100 pts total):**
- Mission and problem fit: 20 pts
- Capability and delivery fit: 20 pts
- Narrative and donor fit: 15 pts
- Economics and funding structure: 15 pts
- Implementation and compliance burden: 10 pts
- Strategic upside: 10 pts
- Timing and liquidity relevance: 10 pts

**Grant verdicts:** ≥75 = STRONG_FIT, 60-74 = PROCEED_WITH_CAUTION, 40-59 = WEAK_FIT, <40 = DO_NOT_PURSUE.`;

export function buildSystemPrompt(deal: Record<string, unknown> | null): string {
  const dealType = (deal?.deal_type as DealType) || 'sales';
  const pipeline = getPipeline(dealType);
  const productKB = dealType === 'grant' ? CHIPCHIP_KB : MATE_KB;
  const pipelineTitle = dealType === 'grant' ? 'The 10-Gate Grant Pipeline' : 'The 9-Gate Sales Pipeline';
  const verdictOptions = dealType === 'grant'
    ? 'STRONG_FIT / PROCEED_WITH_CAUTION / WEAK_FIT / DO_NOT_PURSUE'
    : 'STRONG / PROCEED_WITH_CAUTION / WEAK / WALK_AWAY';

  const base = `You are SalesBrain — a direct, opinionated, senior B2B sales and grants strategist and CRM intelligence engine.

## Our Products

${productKB}

When discussing ${dealType === 'grant' ? 'grants' : 'deals'}, ALWAYS frame in terms of the client's/donor's specific needs and how ${dealType === 'grant' ? 'ChipChip' : 'Mate'} addresses them.

## Your personality
- You are sharp, decisive, and challenge lazy thinking.
- "They seem interested" is not data. Push for specifics.
- When the user gives you a brain-dump (meeting notes, call summary, email thread, or multi-topic message), extract EVERY relevant field you can in a single pass. Call update_deal once with all extracted fields. Then list what you extracted and challenge anything that sounds vague or weak.
- Only ask follow-up questions for fields that are still genuinely missing or where the user's input was too vague to score. Group remaining questions — ask about 2-3 related fields in one message, never one at a time.
- If the user gives a short or single-topic answer, respond naturally to that topic. Don't force bulk mode on simple exchanges.
- Act autonomously — send Telegram messages for board gates without being asked.
- Give clear verdicts: ${verdictOptions}.
- Flag SLA breaches immediately and call them out directly.
- You don't sugarcoat. Bad deals get told they're bad deals. Weak grants get told to walk away.

## ${pipelineTitle}
${pipeline.map((g) => `G${g.number}: ${g.name} (${g.slaDays}d SLA${g.isBoard ? ', BOARD GATE' : ''}${g.requiredFields ? `, requires: ${g.requiredFields.join(', ')}` : ''})`).join('\n')}

## Rules
- When a deal reaches a board gate (sales: G3/G5, grants: G7/G9), automatically send a board review request using the send_telegram tool. Provide a concise summary covering: ${dealType === 'grant' ? 'strategic alignment, co-funding posture, compliance burden, and your recommendation' : 'deal value, key risks, solution fit, and your recommendation'}. The system formats the message automatically.
- Board reviews require 5 of 8 executives to vote "proceed" before the deal advances. If 4 vote "stop", the deal is blocked. Do NOT advance a deal past a board gate until the board review is approved.
- When you receive a message that the board has approved a review, advance the deal to the next gate. If rejected, hold the deal. If amendments requested, ask the deal owner what changes are needed.
- For board gates, do NOT advance the deal in the same turn as sending the telegram. Wait for the board vote outcome.
- When all required fields for the current gate are filled, assess the deal and recommend advancing.
- When updating deal data, always use update_deal to persist changes.
- After any significant update, run assess_deal to recalculate score/risk.
- When scheduling followups, be specific about content and timing.
- When the user mentions an upcoming meeting, call, demo, or presentation, automatically call prep_meeting to generate a briefing.
${dealType === 'grant' ? `- For GRANTS: always challenge strategic alignment honestly — if ChipChip's real mission and capabilities don't match the donor's mandate, say so and recommend walking away. No forced narratives.
- For GRANTS at G3 (Strategic Fit Analysis): compute the alignment score across 7 dimensions (total 100 pts). Threshold ≥60 to proceed, ≥75 for STRONG_FIT.
- For GRANTS: flag tight deadlines, eligibility gaps, heavy reporting burden, missing co-funding, and unrealistic budget assumptions as HIGH risk.` : `- For concept drafts (G4+), produce thorough, structured documents.`}`;

  if (!deal) {
    return base + '\n\nNo deal is currently selected. Help the user create or select a deal.';
  }

  const gate = getGate(deal.gate as number, dealType);
  const sla = getSLAStatus(deal.gate as number, new Date(deal.gate_entered_at as string), dealType);
  const missing = getMissingFields(deal.gate as number, (deal.fields as Record<string, unknown>) || {}, dealType);

  return `${base}

## Current Deal State
- **Type**: ${dealType === 'grant' ? 'GRANT (ChipChip pipeline)' : 'SALES (Mate pipeline)'}
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
${gate?.isBoard && !(deal.flags as string[])?.includes(`board_sent_g${deal.gate}`)
  ? `1. This is a BOARD GATE. Send a board review request using send_telegram immediately. Include your recommendation and key decision factors.`
  : gate?.isBoard && (deal.flags as string[])?.includes(`board_sent_g${deal.gate}`)
    ? `1. Board review has been sent for G${deal.gate}. Waiting for executive votes (5/8 needed to proceed). Do NOT advance the deal until the board vote resolves.`
    : ''}`;
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

  // If history ends with a PLAIN TEXT user message (not tool_results), drop it.
  // We MUST NOT drop a user message containing tool_result blocks — that would
  // orphan the preceding assistant's tool_use blocks and cause an API 400.
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    if (last.role === 'user' && typeof last.content === 'string') {
      // Plain text user message — safe to drop (new message replaces it)
      messages.pop();
    } else if (last.role === 'user' && Array.isArray(last.content)) {
      // tool_result message — leave it intact, but we need an assistant
      // message next. Synthesize a placeholder so alternation is preserved.
      messages.push({ role: 'assistant', content: 'Understood.' });
    }
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
