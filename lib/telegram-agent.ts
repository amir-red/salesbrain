/**
 * Telegram assistant bridge — converts a free-text message from a linked
 * Telegram user into a Claude conversation with SalesBrain's MCP tools
 * attached, then routes the reply back over Telegram.
 *
 * Design:
 *   - Reuses `lib/mcp/tool-definitions.ts` (the same 19 tools) so Telegram
 *     users get exactly the surface as MCP clients do.
 *   - Reuses `lib/mcp/tool-dispatch.ts` — tools execute with the linked
 *     SalesBrain user's identity + visibility scope.
 *   - Uses the shared `MODEL` constant from `lib/llm.ts` and the same
 *     Anthropic client — no separate model config to keep in sync.
 *   - Message history is NOT persisted (yet) — each Telegram message is
 *     a fresh single-turn interaction with tool-use loop until end_turn.
 *     Multi-turn history (like the deal chat) is a follow-up.
 *
 * Message flow:
 *   1. Telegram user sends "what's on my pipeline?"
 *   2. Bot POSTs the message + AuthContext (from lookupTelegramLink) here
 *   3. We ask Claude with tools=[19 MCP tools]
 *   4. Claude may loop tool_use/tool_result up to MAX_ITERATIONS
 *   5. Final text goes back to Telegram
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODEL } from './llm';
import { MCP_TOOLS } from './mcp/tool-definitions';
import { dispatchTool } from './mcp/tool-dispatch';
import type { AuthContext } from './mcp/auth';
import type { LinkedUser } from './telegram-links';

const anthropic = new Anthropic();

const MAX_ITERATIONS = 6;

// Telegram messages have a 4096-char cap. We reserve some headroom for
// formatting and truncate long assistant replies.
const TELEGRAM_MAX_MSG_LEN = 3900;

// ─── System prompt tailored for phone-first UX ────────────────────

function systemPrompt(user: LinkedUser): string {
  return `You are the SalesBrain assistant answering ${user.user_name} (${user.user_email}) via Telegram DM.

Role: help them think about their deals — brainstorm, look up context, update records when asked.

Constraints:
- You act with ${user.user_name}'s identity and visibility scope. Non-admins only see deals they created or are assigned to lead.
- Keep replies SHORT — Telegram messages are read on a phone. 3-6 short lines is ideal. Bullet points OK.
- No headers, no long preambles. Get to the answer.
- When you use a tool, do it silently — don't narrate "I'll call get_deal". Just do it and use the result.
- Do NOT write in Markdown formatting other than simple bullets. Telegram renders plain text — asterisks and underscores WILL show as literal characters.

Available tools:
- Read tools (safe, always allowed): get_deal, list_deals, get_pipeline_overview, get_relevant_lessons, get_memories, list_sales_leads, get_sales_lead
- Write tools (change data): update_deal, add_deal_note, create_deal, mark_deal_lost, assess_deal, schedule_followup, remember, forget, convert_lead_to_deal
- Admin tools (only if ${user.user_role} = 'admin'): send_telegram, send_email, advance_gate

Before any write action, briefly confirm what you're about to do in one line and proceed. Don't ask a confirming question for read tools.

Today is ${new Date().toISOString().slice(0, 10)}.`;
}

// ─── Public entry point ──────────────────────────────────────────

export interface AgentReply {
  text: string;
  tool_calls: number;
  duration_ms: number;
}

/**
 * Run a single Telegram message through Claude with MCP tools.
 * Returns the reply text ready to send back. Never throws — errors are
 * surfaced in the reply itself so the user knows what happened.
 */
export async function processMessage(
  user: LinkedUser,
  messageText: string,
): Promise<AgentReply> {
  const started = Date.now();
  const ctx: AuthContext = {
    token_id: `telegram:${user.link_id}`,   // synthetic — no MCP token row
    user_id: user.user_id,
    user_email: user.user_email,
    user_role: user.user_role,
    user_name: user.user_name,
    is_admin: user.user_role === 'admin',
  };

  // Convert MCP tool defs to Anthropic tool shape
  const tools: Anthropic.Tool[] = MCP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
  }));

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: messageText },
  ];

  let toolCalls = 0;
  let iterations = 0;
  let finalText = '';

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: systemPrompt(user),
        tools,
        messages,
      });

      // Extract text as we go — keep the last non-empty block as the reply.
      let lastText = '';
      for (const block of response.content) {
        if (block.type === 'text') lastText += block.text;
      }
      if (lastText) finalText = lastText;

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      if (toolUses.length === 0 || response.stop_reason === 'end_turn') break;

      // Push the assistant's turn (including tool_use blocks) into history
      messages.push({ role: 'assistant', content: response.content });

      // Dispatch each tool_use → build tool_result blocks
      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (b) => {
          toolCalls++;
          const result = await dispatchTool(b.name, b.input as Record<string, unknown>, ctx);
          const payload =
            result.status === 'success'
              ? JSON.stringify(result.data ?? null)
              : JSON.stringify({ error: result.error });
          return {
            type: 'tool_result' as const,
            tool_use_id: b.id,
            content: payload,
            is_error: result.status !== 'success',
          };
        }),
      );

      messages.push({ role: 'user', content: toolResults });
    }
  } catch (err) {
    finalText = `⚠️ Something went wrong: ${err instanceof Error ? err.message : 'unknown error'}. Try again in a moment or ping @amir if it persists.`;
  }

  if (!finalText.trim()) {
    finalText = "I don't have anything to reply with. Ask again with a bit more context?";
  }
  if (finalText.length > TELEGRAM_MAX_MSG_LEN) {
    finalText = finalText.slice(0, TELEGRAM_MAX_MSG_LEN) + '\n… (reply truncated)';
  }

  return {
    text: finalText,
    tool_calls: toolCalls,
    duration_ms: Date.now() - started,
  };
}
