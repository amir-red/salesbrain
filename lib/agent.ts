import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'fs';
import path from 'path';
import pool from './db';
import { TOOLS } from './tools';
import { executeTool } from './tool-executors';
import { getPipeline, getGate, getMissingFields, getSLAStatus, GRANT_MONEY_FIELDS, type DealType } from './gates';
import { computeGrantPipelineRank, formatRankForPrompt } from './grant-pipeline-rank';
import { classify } from './file-extractor';
import { loadMemoriesForPrompt, formatMemoryBlock } from './memory';
import { MODEL, webSearchTool } from './llm';
import { loadRelevantLessons, formatLessonsBlock } from './lessons';

const anthropic = new Anthropic();

const MAX_ITERATIONS = 6;

// ─── System Prompt Builder ──────────────────────────────────────

const ZEAMI_KB = `## Zeami (for SALES deals)

Zeami is a **work intelligence and automation readiness platform** for organizations running significant computer-based work (knowledge work, back-office, operations, creative and analytical roles).

**What it does (observe → understand → prioritize → assist):**
1. Ground-truth visibility — captures how work actually happens on desktops
2. Process understanding — turns raw activity into named workflows with intent and steps
3. Efficiency & opportunity insight — classifies where work is heavy, repetitive, error-prone, or fragmented
4. Assistive automation — AI-powered helpers grounded in real workflows

**Key value:** Faster process discovery, higher-quality automation backlog, aligned improvement across business/IT/employees, measurable follow-through, employee-centric enablement.

**What Zeami is NOT:** Not surveillance, not a replacement for human judgment, not automation-without-understanding.

**Elevator pitch:** Zeami turns desktop work into structured workflows and clear improvement signals. Organizations gain evidence-based view of how work flows, where it slows down, and what's worth automating — then connect that insight to practical AI assistance.`;

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

/**
 * Returns the system prompt split into two parts so the stable region can
 * be marked `cache_control: ephemeral` at the call site:
 *  - `stable`: product KB + personality + pipeline + rules + field hints.
 *    Only depends on `deal_type` so it cache-hits across all turns of a
 *    deal within the 5-minute TTL.
 *  - `dynamic`: current-deal state, missing-field warnings, board hints,
 *    `extraContext`. Changes every turn — never cached.
 */
export function buildSystemPrompt(
  deal: Record<string, unknown> | null,
  extraContext?: string,
  memoryBlock?: string,
  lessonsBlock?: string
): { stable: string; dynamic: string } {
  const dealType = (deal?.deal_type as DealType) || 'sales';
  const pipeline = getPipeline(dealType);
  const productKB = dealType === 'grant' ? CHIPCHIP_KB : ZEAMI_KB;
  const pipelineTitle = dealType === 'grant' ? 'The 10-Gate Grant Pipeline' : 'The 9-Gate Sales Pipeline';
  const verdictOptions = dealType === 'grant'
    ? 'STRONG_FIT / PROCEED_WITH_CAUTION / WEAK_FIT / DO_NOT_PURSUE'
    : 'STRONG / PROCEED_WITH_CAUTION / WEAK / WALK_AWAY';

  const base = `You are SalesBrain — a direct, opinionated, senior B2B sales and grants strategist and CRM intelligence engine.

## Our Products

${productKB}

When discussing ${dealType === 'grant' ? 'grants' : 'deals'}, ALWAYS frame in terms of the client's/donor's specific needs and how ${dealType === 'grant' ? 'ChipChip' : 'Zeami'} addresses them.

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

## Pre-deal Prospecting Pipeline
Before a deal exists at G1, prospects move through 10 pre-deal stages: P0_IMPORTED → P1_ENRICHED → P2_ICP_CHECKED → P3_RESEARCH_READY → P4_OUTREACH_DRAFTED → P5_SENT → P6_REPLIED → P7_QUALIFIED (converts to deal) / P8_DISQUALIFIED / P9_ARCHIVED.

Use the prospecting tools (create_or_import_prospect, enrich_prospect, score_prospect_fit, research_company_from_url, generate_research_brief, draft_outreach_message, classify_outreach_reply, convert_prospect_to_deal, archive_prospect) when the user asks to prospect, research, or reach out to companies that are NOT yet deals. When a prospect replies positively (interested/meeting_ready), convert to a sales deal at G1 using convert_prospect_to_deal — don't create a deal manually.

For cold prospects with a website but no research yet:
1. Call research_company_from_url first — it fetches the site, writes a structured brief, updates the account with industry / company_size / location, and advances the prospect to P3_RESEARCH_READY.
2. THEN draft cold outreach using draft_outreach_message with step_type='first_touch'. Reference specifics from the research brief only — do not invent facts.
3. Deliverability is tight: the system enforces a per-user daily send cap (default 50), a 3-minute throttle per recipient domain, and auto-appends an unsubscribe footer. Don't spam. Quality over quantity.

Outreach draft rules:
- Short, credible, founder-led tone. No hype, no exaggeration, no fake personalization.
- Reference specifics from research_brief only when genuinely supported. Don't invent facts.
- Supported types: first_touch, follow_up_1, follow_up_2, breakup.
- BEFORE drafting, check if the contact has a communication_profile (learned from their past messages). If yes, MATCH that tone exactly: formality, typical length, greeting style, sign-off, quirks. If no profile exists but the contact has imported_messages, call analyze_communication_style first. If the contact is new with no history, use the persona_type or seniority to infer formality.
- Always save as draft — a human must approve before send.
- Always save as draft — a human must approve before send.

## Rules
- When a deal reaches a board gate (sales: G3/G7, grants: G3/G7/G9), automatically send a board review request using the send_telegram tool. Provide a concise summary covering: ${dealType === 'grant' ? 'grant amount + our contribution + cofunding split, strategic alignment, pipeline rank vs other active grants, and your recommendation' : 'deal value, key risks, solution fit, and your recommendation'}. The system formats the message automatically.${dealType === 'sales' ? '\n- For the **G7 board review specifically**, the summary MUST include the negotiated `deployment_plan` value (`on_premise` or `saas_cloud`). The board needs to know the infrastructure choice they\'re approving — it has very different cost, security, and support implications.' : ''}
- Board reviews require 5 of 8 executives to vote "proceed" before the deal advances. If 4 vote "stop", the deal is blocked. Do NOT advance a deal past a board gate until the board review is approved.
- When you receive a message that the board has approved a review, advance the deal to the next gate. If rejected, hold the deal. If amendments requested, ask the deal owner what changes are needed.
- For board gates, do NOT advance the deal in the same turn as sending the telegram. Wait for the board vote outcome.
- When all required fields for the current gate are filled, assess the deal and recommend advancing.
- When updating deal data, always use update_deal to persist changes.
- After any significant update, run assess_deal to recalculate score/risk.
- When scheduling followups, be specific about content and timing.
- When the user mentions an upcoming meeting, call, demo, or presentation, automatically call prep_meeting to generate a briefing.
- **Memory**: when the user explicitly says "remember X" / "in the future, always Y" / "next time..." OR when a clear cross-deal lesson emerges that isn't deal-specific, call \`remember\`. Pick scope="org" for team-wide lessons ("we always...", "the team should..."), scope="user" for the current user's personal preference ("I prefer...", "for me always..."). NEVER use \`remember\` for deal-specific facts — those go in \`update_deal\` (fields/notes). When the user says "forget mem_xxxx", call \`forget\` with that id. The system loads existing memories into the prompt under "## Memory" with their ids in brackets — apply them whenever relevant, without announcing the memory system unless asked.
- **Web search**: you have access to a live \`web_search\` tool (Anthropic-hosted). Use it when the user asks about a real-world organization, person, market, donor, or current event that you can't answer reliably from training data alone — e.g. "who's the CEO of Ethiopia Investment Holdings", "recent news on this donor", "what's this company's headcount?", "what does this org do?". Don't search for things you obviously know (basic concepts, ChipChip's own pipeline, our own product, the deal's own captured fields). Don't search to pad a confident answer. When you do search, cite the source URL(s) in your reply so the user can verify. Cap yourself at a few targeted searches per turn — it's a paid tool.
- **Marking deals lost + lessons**: when the user says they lost a deal, got rejected, walked away with a real reason, or asks you to record a loss, call \`mark_deal_lost\` with structured fields parsed from their message (reason, root_cause, optional competitor, lesson). NEVER call this for vague frustration or speculation — only when the loss is final. After marking, briefly summarize what got recorded and remind them the lesson will surface on similar future deals.
- **Lessons from past losses**: if a "## Lessons from similar past losses" section appears in the prompt, those are real past deals like this one where we lost. Apply them PROACTIVELY: if the current deal is heading toward the same root cause (price pressure, eligibility mismatch, decision-maker missing, etc.), say so directly and name the past company so the user can dig in. Don't repeat the lesson verbatim — synthesize the warning in the current context. If the pattern doesn't apply, ignore the lessons section. For grants specifically, if past losses show repeated eligibility losses, ask the eligibility question explicitly at G1: donor's entity rules, geography, sector, org-age, registration status — confirm before investing more time.
${dealType === 'sales' ? `
## Sales-specific field hints
- **deployment_plan** (required at G7 Negotiation, before Close): the client must pick how Zeami will be deployed for them. Two valid values ONLY:
  - \`"on_premise"\` — Secure local deployment. Air-gapped compliance, full infrastructure control. Suits regulated industries, security-sensitive orgs, or air-gapped environments.
  - \`"saas_cloud"\` — Fully managed Zeami cloud instance. Auto-scaling infrastructure, instant updates, included support. Suits faster rollouts and orgs without infra teams.
  Ask the question explicitly with both options and a one-line description of each. Persist the answer via update_deal with fields.deployment_plan set to one of those two strings. Never advance past G7 without it — the onboarding row at G9 reads this to set up the correct deployment path.
` : ''}${dealType === 'grant' ? `## Grant-specific rules (MONEY FIRST, OPPORTUNITY-COST DISCIPLINE)
- ALWAYS clarify money before anything else. Your FIRST question on any new grant must be: "How much is the grant (min and max)? What's our contribution (cash + in-kind)? What's the cofunding split (full grant / 75-25 / 50-50 / 25-75)?" If those aren't on the deal, get them now. Do not advance past G1 without them.
- At G2 (Quick Triage), an injected "Grant Pipeline Comparison" section will tell you where this grant ranks against other active grants by total value. If this grant is in the bottom third while bigger ones are open, recommend de-prioritizing or dropping. Force the user to confront opportunity cost — say it directly: "There's a USD 1.2M grant at G3 already. Why are we burning time on this USD 80K one?"
- At G3 (Strategic Fit + EARLY BOARD REVIEW), the board votes BEFORE you do any relationship work or concept drafting. Compute the alignment score (7 dimensions, 100 pts: mission 20 / capability 20 / narrative 15 / economics 15 / compliance 10 / upside 10 / timing 10). Threshold ≥60 to proceed, ≥75 for STRONG_FIT. Send the board the money + alignment + pipeline rank + your recommendation. WAIT for the vote before advancing.
- At G7 (Partner Lock) and G9 (Award Setup), the board votes again — these are commitment points before submission and signing.
- Always challenge strategic alignment honestly — if ChipChip's real mission and capabilities don't match the donor's mandate, say so and recommend walking away. No forced narratives.
- Flag HIGH risk: tight deadlines, eligibility gaps, heavy reporting burden, missing co-funding source, unrealistic budget, contribution > 30% of total grant value.
- Verdict enum for grants: STRONG_FIT / PROCEED_WITH_CAUTION / WEAK_FIT / DO_NOT_PURSUE.` : `- For concept drafts (G4+), produce thorough, structured documents.`}`;

  if (!deal) {
    return {
      stable: base,
      dynamic: '\n\nNo deal is currently selected. Help the user create or select a deal.'
        + (memoryBlock || '')
        + (lessonsBlock || ''),
    };
  }

  const gate = getGate(deal.gate as number, dealType);
  const sla = getSLAStatus(deal.gate as number, new Date(deal.gate_entered_at as string), dealType);
  const missing = getMissingFields(deal.gate as number, (deal.fields as Record<string, unknown>) || {}, dealType);

  // ─── Backward-compat: cross-gate money-field check for grants ────
  // Existing grants past G1 may have advanced before the new money fields were
  // added. Check ALL grants regardless of gate so the AI asks for them.
  const dealFields = (deal.fields as Record<string, unknown>) || {};
  const missingMoney: string[] = dealType === 'grant'
    ? GRANT_MONEY_FIELDS.filter((f) => {
        const v = dealFields[f];
        return v === undefined || v === null || v === '';
      })
    : [];

  // ─── Backward-compat: G3 board-review backfill ──────────────────
  // Existing grants past G3 never went through the new G3 board gate.
  // Trigger a one-time backfill (only when money fields are filled, since
  // a board review without money is useless).
  const flags = (deal.flags as string[]) || [];
  const needsG3Backfill =
    dealType === 'grant' &&
    (deal.gate as number) >= 3 &&
    !flags.includes('board_sent_g3') &&
    missingMoney.length === 0;

  // ─── Dynamic per-turn block (deal state + actionables) ──────────
  // Keep this isolated from `base` so the system prompt array in
  // anthropic.messages.create() can place a cache breakpoint between them.
  const dynamic = `

## Current Deal State
- **Type**: ${dealType === 'grant' ? 'GRANT (ChipChip pipeline)' : 'SALES (Zeami pipeline)'}
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
${missingMoney.length > 0
  ? `0. ⚠️ MONEY FIELDS MISSING (highest priority — gate advancement is BLOCKED): **${missingMoney.join(', ')}**. Ask the user for these now BEFORE anything else. The system will refuse update_deal with a new gate until they're filled. When the user replies with money info, call update_deal with a fields object containing the values (numbers for amounts, strings for type/split — accepted values: type ∈ {none, cash, in_kind, mixed}, split ∈ {full_grant, 75_25, 50_50, 25_75, other}).`
  : ''}
${needsG3Backfill
  ? `1. 🔁 BACKFILL G3 BOARD REVIEW: This grant is at G${deal.gate} but never went through the new G3 board review (no board_sent_g3 flag). Send a G3 review NOW via send_telegram with gate=3. Include money breakdown, alignment score, pipeline rank, and your recommendation. This is purely audit-trail backfill — the deal stays at G${deal.gate}, the board vote does not auto-advance it.`
  : ''}
${sla.status === 'breached' ? '2. IMMEDIATELY flag the SLA breach and suggest action.' : ''}
${missing.length > 3
  ? `2. There are ${missing.length} missing fields for the current gate: **${missing.join(', ')}**. Invite the user to brain-dump everything they know — meeting notes, call summaries, emails. Extract all fields you can from their response in one pass using update_deal, then follow up only on what's still missing.`
  : missing.length > 0
    ? `2. These fields are still missing for the current gate: **${missing.join(', ')}**. Ask about all of them in a single grouped question.`
    : ''}
${gate?.isBoard && !(deal.flags as string[])?.includes(`board_sent_g${deal.gate}`)
  ? `1. This is a BOARD GATE. Send a board review request using send_telegram immediately. Include your recommendation and key decision factors.`
  : gate?.isBoard && (deal.flags as string[])?.includes(`board_sent_g${deal.gate}`)
    ? `1. Board review has been sent for G${deal.gate}. Waiting for executive votes (5/8 needed to proceed). Do NOT advance the deal until the board vote resolves.`
    : ''}
${extraContext ? `\n${extraContext}` : ''}${memoryBlock || ''}${lessonsBlock || ''}`;

  return { stable: base, dynamic };
}

// ─── Load Conversation History ──────────────────────────────────

export async function loadHistory(dealId: string): Promise<Anthropic.MessageParam[]> {
  // LIMIT 200: months of typical deal history. Well inside Sonnet 4's 200k
  // context window, and prompt caching (in runAgent) keeps the cost bounded
  // on repeat calls. The cycle trim below ensures the window starts at a
  // real cycle boundary so the trailing safety shift can never orphan a
  // tool pair (the root cause of the recurring messages.0.content.0 400).
  const { rows } = await pool.query(
    `SELECT role, content, tool_name, tool_input
     FROM conversations
     WHERE deal_id = $1
     ORDER BY created_at DESC
     LIMIT 200`,
    [dealId]
  );

  // Phase 0: Cycle-aware row cutoff
  // The LIMIT can land mid-tool-cycle, leaving the window starting with
  // assistant/tool_use/tool_result whose paired rows fall outside the
  // window. Skip leading non-`user` rows so Phase 1 always starts at a
  // clean conversation boundary.
  const all = rows.reverse();
  let start = 0;
  while (start < all.length && all[start].role !== 'user') start++;
  // Defensive fallback: if every row is non-user (practically impossible
  // for real chats), keep the full set rather than emptying the history.
  const ordered = start < all.length ? all.slice(start) : all;

  // Phase 1: Reconstruct Anthropic message format from flat DB rows
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
  // CRITICAL: never drop a message containing tool_use or tool_result blocks —
  // doing so would orphan the matching block in the adjacent message and the
  // Anthropic API will reject the request with a 400.
  const hasStructuredBlocks = (m: Anthropic.MessageParam): boolean => {
    if (!Array.isArray(m.content)) return false;
    return (m.content as Array<{ type?: string }>).some(
      (b) => b.type === 'tool_use' || b.type === 'tool_result'
    );
  };

  const final: Anthropic.MessageParam[] = [];
  for (const msg of validated) {
    const prev = final[final.length - 1];
    if (prev && prev.role === msg.role) {
      const prevStructured = hasStructuredBlocks(prev);
      const msgStructured = hasStructuredBlocks(msg);
      if (prevStructured && !msgStructured) {
        // Keep the structured one (prev); drop the new plain-text duplicate.
        continue;
      } else if (!prevStructured && msgStructured) {
        // Drop the previous plain-text; keep the structured one.
        final.pop();
        final.push(msg);
      } else if (prevStructured && msgStructured) {
        // Both structured (rare). Merge their content arrays so neither's
        // tool_use/tool_result blocks get orphaned.
        const merged = [
          ...(prev.content as Anthropic.ContentBlockParam[]),
          ...(msg.content as Anthropic.ContentBlockParam[]),
        ];
        final[final.length - 1] = { role: prev.role, content: merged };
      } else {
        // Both plain text — keep newer.
        final.pop();
        final.push(msg);
      }
    } else {
      final.push(msg);
    }
  }

  // Phase 4a: Strip any orphaned tool_use blocks.
  // For each assistant message containing tool_use blocks, verify the very
  // next message contains a tool_result for every tool_use_id. If not, drop
  // the orphaned tool_use blocks (preserve text content).
  const safeForward: Anthropic.MessageParam[] = [];
  for (let k = 0; k < final.length; k++) {
    const msg = final[k];
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const blocks = msg.content as Array<{ type: string; id?: string; text?: string }>;
      const toolUseIds = blocks.filter((b) => b.type === 'tool_use' && b.id).map((b) => b.id!);
      if (toolUseIds.length > 0) {
        const next = final[k + 1];
        const resultIds = new Set<string>();
        if (next && next.role === 'user' && Array.isArray(next.content)) {
          for (const b of next.content as Array<{ type?: string; tool_use_id?: string }>) {
            if (b.type === 'tool_result' && b.tool_use_id) resultIds.add(b.tool_use_id);
          }
        }
        const allMatched = toolUseIds.every((id) => resultIds.has(id));
        if (!allMatched) {
          // Strip ALL tool_use blocks from this assistant message; keep text.
          const textOnly = blocks
            .filter((b) => b.type === 'text' && b.text)
            .map((b) => b.text!)
            .join('');
          if (textOnly) safeForward.push({ role: 'assistant', content: textOnly });
          continue;
        }
      }
    }
    safeForward.push(msg);
  }

  // Phase 4b: Mirror sweep — strip orphaned tool_result blocks.
  // For each user message containing tool_result blocks, verify the IMMEDIATELY
  // preceding assistant message has matching tool_use blocks. If not, drop the
  // orphaned tool_result blocks. If the message has no other content after
  // stripping, drop the message entirely. Without this pass an Anthropic 400
  // can fire as: "unexpected tool_use_id found in tool_result blocks: …"
  const safe: Anthropic.MessageParam[] = [];
  for (let k = 0; k < safeForward.length; k++) {
    const msg = safeForward[k];
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const blocks = msg.content as Array<{ type?: string; tool_use_id?: string; text?: string }>;
      const hasResults = blocks.some((b) => b.type === 'tool_result' && b.tool_use_id);
      if (hasResults) {
        const prev = safeForward[k - 1];
        const prevToolUseIds = new Set<string>();
        if (prev && prev.role === 'assistant' && Array.isArray(prev.content)) {
          for (const b of prev.content as Array<{ type?: string; id?: string }>) {
            if (b.type === 'tool_use' && b.id) prevToolUseIds.add(b.id);
          }
        }
        // Keep only tool_result blocks whose tool_use_id is in the prev assistant,
        // plus any non-tool_result blocks (rare — usually a tool_result-only msg).
        const kept = blocks.filter((b) => {
          if (b.type === 'tool_result') return b.tool_use_id ? prevToolUseIds.has(b.tool_use_id) : false;
          return true;
        });
        if (kept.length === 0) continue;     // entire message was orphan results — drop it
        if (kept.length !== blocks.length) {
          safe.push({ role: 'user', content: kept as Anthropic.ContentBlockParam[] });
          continue;
        }
      }
    }
    safe.push(msg);
  }

  // Phase 5: Trim the front until safe[0] is a "clean" user message.
  // The previous version only checked role, but shifting off a leading
  // assistant could leave a user(tool_result) at the front whose matching
  // tool_use was just removed → Anthropic 400. Now we also drop any
  // leading user whose content is purely tool_result blocks.
  while (safe.length > 0) {
    const first = safe[0];
    if (first.role !== 'user') {
      safe.shift();
      continue;
    }
    if (Array.isArray(first.content)) {
      const blocks = first.content as Array<{ type?: string }>;
      const allToolResult = blocks.length > 0
        && blocks.every((b) => b.type === 'tool_result');
      if (allToolResult) {
        safe.shift();
        continue;
      }
    }
    break;
  }

  return safe;
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

// ─── Attachment loader ─────────────────────────────────────────

/**
 * Load a file_attachments row from disk and convert it to an Anthropic content
 * block. Text-extracted files become text blocks; PDFs become document blocks;
 * images become image blocks.
 */
async function loadAttachmentBlock(att: {
  filename: string;
  mime_type: string;
  storage_path: string;
  extracted_text: string | null;
}): Promise<Anthropic.ContentBlockParam | null> {
  const kind = classify(att.mime_type);

  if (kind === 'text') {
    const text = att.extracted_text || '';
    return { type: 'text', text: `## Attached file: ${att.filename}\n\n${text}` };
  }

  // PDF / image: read the file from disk and base64-encode for the API.
  if (kind === 'pdf' || kind === 'image') {
    try {
      const fullPath = path.isAbsolute(att.storage_path)
        ? att.storage_path
        : path.join(process.cwd(), att.storage_path);
      const buf = await fs.readFile(fullPath);
      if (kind === 'pdf') {
        return {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: buf.toString('base64'),
          },
        };
      }
      // image
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: att.mime_type as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
          data: buf.toString('base64'),
        },
      };
    } catch (err) {
      console.error(`[loadAttachmentBlock] read failed for ${att.filename}:`, err);
      return { type: 'text', text: `[Attachment ${att.filename} could not be loaded]` };
    }
  }

  return null;
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
  userId?: string,
  attachmentIds?: string[],
  userEmail?: string
): AsyncGenerator<StreamEvent> {
  // Load deal. If userId is provided (non-admin caller), scope to the user's
  // visible deals: those they created (user_id) OR are assigned as lead on
  // (lead_id). Admins call with userId=undefined and see everything.
  const dealQuery = userId
    ? `SELECT d.*, u.name as lead_name, u.email as lead_email
       FROM deals d LEFT JOIN users u ON u.id = d.lead_id
       WHERE d.id = $1 AND (d.user_id = $2 OR d.lead_id = $2)`
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

  // ── Attachments: load files, build content blocks for Claude ──
  // The user message becomes an array: text + each attachment as a content block.
  let attachmentNames: string[] = [];
  let userContent: Anthropic.MessageParam['content'] = userMessage;

  if (attachmentIds && attachmentIds.length > 0) {
    try {
      const { rows: attRows } = await pool.query(
        `SELECT id, filename, mime_type, storage_path, extracted_text
         FROM file_attachments WHERE id = ANY($1::uuid[]) AND deal_id = $2`,
        [attachmentIds, dealId]
      );

      const blocks: Anthropic.ContentBlockParam[] = [];

      // Lead with the user's typed message (or a placeholder if empty)
      blocks.push({
        type: 'text',
        text: userMessage || '(see attached files)',
      });

      for (const att of attRows) {
        attachmentNames.push(att.filename);
        const block = await loadAttachmentBlock(att);
        if (block) blocks.push(block);
      }

      if (blocks.length > 1) {
        userContent = blocks;
      }
    } catch (err) {
      console.error('[runAgent] failed to load attachments:', err);
    }
  }

  messages.push({ role: 'user', content: userContent });

  // Persist after building the array. Include filenames in the persisted text
  // so the conversation history shows "the user attached X".
  const persistedText = attachmentNames.length > 0
    ? `${userMessage}\n\n[Attached files: ${attachmentNames.join(', ')}]`
    : userMessage;
  await persistMessage(dealId, 'user', persistedText);

  // For grant deals at early gates (G1-G3), inject the pipeline rank so the
  // AI can do opportunity-cost reasoning vs other active grants.
  let extraContext: string | undefined;
  if (deal.deal_type === 'grant' && (deal.gate as number) <= 3) {
    try {
      const rank = await computeGrantPipelineRank(dealId);
      if (rank) extraContext = formatRankForPrompt(rank);
    } catch (err) {
      console.warn('[runAgent] grant pipeline rank failed:', err);
    }
  }

  // Load shared agent memories (org + per-user). Lives in the dynamic half
  // of the prompt so it never invalidates the cached stable prefix. Failure
  // here is non-fatal — agent still runs without memories.
  let memoryBlock = '';
  try {
    const mem = await loadMemoriesForPrompt(userEmail);
    memoryBlock = formatMemoryBlock(mem);
  } catch (err) {
    console.warn('[runAgent] memory load failed:', err);
  }

  // Load up to 3 most-relevant past losses (same deal_type, adjacent gate,
  // similar value). The agent uses these to proactively warn about repeat
  // patterns — the "we always lose when we do X" feedback loop. Empty when
  // there are no matching lessons; the block is omitted entirely.
  let lessonsBlock = '';
  try {
    const lessons = await loadRelevantLessons({
      id: deal.id as string,
      deal_type: (deal.deal_type as 'sales' | 'grant') || 'sales',
      gate: deal.gate as number,
      value: deal.value as string | null,
    });
    lessonsBlock = formatLessonsBlock(lessons);
  } catch (err) {
    console.warn('[runAgent] lessons load failed:', err);
  }

  // Split the system prompt so the stable region (product KB, personality,
  // pipeline, rules, field hints) can be marked as cacheable. Subsequent
  // turns of the same deal session within 5 minutes hit the cache, paying
  // ~10× less for that prefix — important now that LIMIT is 200.
  const { stable: stableSystem, dynamic: dynamicSystem } = buildSystemPrompt(
    deal,
    extraContext,
    memoryBlock,
    lessonsBlock,
  );

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [
        // Stable prefix — cacheable. The cache_control breakpoint after this
        // block also captures `tools` (which is the same array every call).
        { type: 'text', text: stableSystem, cache_control: { type: 'ephemeral' } },
        // Per-turn deal state — small, never cached.
        { type: 'text', text: dynamicSystem },
      ],
      // Function tools (our `executeTool` dispatcher) + Anthropic's hosted
      // web_search server tool. The model picks `web_search` when it needs
      // a live fact it can't answer from training data; results come back
      // as `web_search_tool_result` blocks the SDK handles transparently.
      tools: [...TOOLS, webSearchTool],
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
          result = await executeTool(block.name, toolInput, { userId, userEmail, dealId });
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
