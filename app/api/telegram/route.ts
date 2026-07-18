import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { runAgent } from '@/lib/agent';
import { sendTelegramMessage, sendChatMessage, formatVoteTallyReply, formatBoardResolution } from '@/lib/telegram';
import { consumeLinkToken, lookupTelegramLink } from '@/lib/telegram-links';
import { processMessage as runAgentBridge, type AnonymousCaller } from '@/lib/telegram-agent';

// Per-user-per-chat rate limit for group mentions (in-process, sliding window).
const MENTION_WINDOW_MS = 60 * 1000;
const MENTION_LIMIT = 10;
const mentionBuckets = new Map<string, number[]>();
function mentionAllowed(chatId: number, fromId: number): boolean {
  const key = `${chatId}:${fromId}`;
  const now = Date.now();
  const fresh = (mentionBuckets.get(key) ?? []).filter((ts) => ts > now - MENTION_WINDOW_MS);
  if (fresh.length >= MENTION_LIMIT) { mentionBuckets.set(key, fresh); return false; }
  fresh.push(now);
  mentionBuckets.set(key, fresh);
  return true;
}

interface TelegramUpdate {
  message?: {
    message_id: number;
    chat?: {
      id: number;
      type?: 'private' | 'group' | 'supergroup' | 'channel';
    };
    from?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    text?: string;
    reply_to_message?: { message_id: number };
    entities?: Array<{ type: string; offset: number; length: number }>;
  };
}

function parseDecision(text: string): 'proceed' | 'stop' | 'amend' | null {
  const lower = text.toLowerCase().trim();
  if (/\b(proceed|go|yes|approve|approved|lgtm|ok)\b/.test(lower)) return 'proceed';
  if (/\b(stop|no|reject|rejected|kill|block)\b/.test(lower)) return 'stop';
  if (/\b(amend|revise|change|modify|redo|rework)\b/.test(lower)) return 'amend';
  return null;
}

export async function POST(req: NextRequest) {
  // Verify webhook secret
  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const update: TelegramUpdate = await req.json();
  const message = update.message;

  if (!message?.text || !message.from) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const text = message.text.trim();
  const chatId = message.chat?.id ?? message.from.id;
  const isPrivateChat = message.chat?.type === 'private';

  // ─── Route 1: /start linking command ─────────────────────────────
  // Format: "/start LINK-XXXXXX" (case-insensitive). Only in private chats
  // to avoid leaking codes in group logs.
  const startMatch = text.match(/^\/start(?:@\w+)?\s+(LINK-[A-Z0-9]+)$/i);
  if (startMatch && isPrivateChat) {
    const rawToken = startMatch[1].toUpperCase();
    try {
      const result = await consumeLinkToken(rawToken, {
        telegram_user_id: message.from.id,
        telegram_chat_id: chatId,
        telegram_username: message.from.username,
        telegram_first_name: message.from.first_name,
        telegram_last_name: message.from.last_name,
      });
      if (!result.ok) {
        await sendChatMessage(chatId, `❌ ${result.reason}\n\nGenerate a fresh code at /settings/telegram and try again.`);
      } else {
        await sendChatMessage(chatId,
          `✅ Linked as ${message.from.first_name || message.from.username || 'you'}.\n\n` +
          `You can now message me in natural language to look up deals, add notes, and more. ` +
          `Try: "what's on my sales pipeline?"`
        );
      }
    } catch (err) {
      console.error('[Telegram] link consume failed:', err);
      await sendChatMessage(chatId, '⚠️ Something went wrong linking your account. Try again shortly.').catch(() => {});
    }
    return NextResponse.json({ ok: true, handled: 'link' });
  }

  // /start with no token (fresh chat with the bot) — a hint back
  if (/^\/start(?:@\w+)?$/i.test(text) && isPrivateChat) {
    await sendChatMessage(chatId,
      `👋 Hi ${message.from.first_name || 'there'}!\n\n` +
      `I'm the SalesBrain assistant. To use me, link your SalesBrain account:\n\n` +
      `1. Log in at https://salescrm.chipchip.social\n` +
      `2. Go to Settings → Telegram → Generate linking code\n` +
      `3. Send me the /start LINK-XXXXXX code\n\n` +
      `Once linked, you can ask me anything about your deals.`
    ).catch(() => {});
    return NextResponse.json({ ok: true, handled: 'start_hint' });
  }

  // ─── Route 4: Group @mention → agent reply ───────────────────────
  // Fires when a user @mentions the bot in a group. Vote replies (Route 2)
  // still take priority for messages that reply-to a pending decision.
  const isGroupChat = message.chat?.type === 'group' || message.chat?.type === 'supergroup';
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  const mentionRegex = botUsername ? new RegExp(`@${botUsername}\\b`, 'i') : null;
  const mentioned = isGroupChat && !!mentionRegex && mentionRegex.test(text);
  const isVoteReply = !!message.reply_to_message;

  if (mentioned && !isVoteReply) {
    return handleGroupMention(message, text, botUsername!);
  }

  // ─── Route 2: Board vote (reply-to in the group chat) ────────────
  // Existing behavior — untouched. Requires the message to be a reply.
  if (!message.reply_to_message) {
    // No reply → not a board vote. Fall through to Route 3 (private chat agent).
    if (isPrivateChat) {
      return handlePrivateChatMessage(chatId, message.from.id, text);
    }
    return NextResponse.json({ ok: true, skipped: true });
  }

  const replyToId = message.reply_to_message.message_id;
  const voterTelegramId = message.from.id;
  const voterName = [message.from.first_name, message.from.last_name]
    .filter(Boolean)
    .join(' ') || message.from.username || 'Unknown';

  // Find pending board decision by telegram message ID
  const { rows } = await pool.query(
    `SELECT bd.*, d.id as deal_id, d.name as deal_name
     FROM board_decisions bd
     JOIN deals d ON d.id = bd.deal_id
     WHERE bd.telegram_message_id = $1 AND bd.status = 'pending'`,
    [replyToId]
  );

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'No matching pending decision' });
  }

  const boardDecision = rows[0];

  // Parse vote
  const vote = parseDecision(message.text);
  if (!vote) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'Could not parse vote' });
  }

  // Extract comment (text beyond the vote keyword)
  const comment = message.text.length > 20 ? message.text : null;

  // Upsert vote (allows vote changes, prevents duplicates)
  await pool.query(
    `INSERT INTO board_votes (board_decision_id, voter_telegram_id, voter_name, vote, comment)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (board_decision_id, voter_telegram_id) DO UPDATE
     SET vote = EXCLUDED.vote, comment = EXCLUDED.comment, created_at = now()`,
    [boardDecision.id, voterTelegramId, voterName, vote, comment]
  );

  // Tally votes
  const { rows: tallyRows } = await pool.query(
    `SELECT vote, COUNT(*)::int as cnt
     FROM board_votes
     WHERE board_decision_id = $1
     GROUP BY vote`,
    [boardDecision.id]
  );

  const tally = { proceed: 0, stop: 0, amend: 0 };
  for (const row of tallyRows) {
    if (row.vote in tally) tally[row.vote as keyof typeof tally] = row.cnt;
  }

  const votesRequired = boardDecision.votes_required as number;
  const votesToBlock = boardDecision.votes_to_block as number;

  // Check thresholds
  let resolved: 'approved' | 'rejected' | 'amended' | null = null;

  if (tally.proceed >= votesRequired) {
    resolved = 'approved';
  } else if (tally.stop >= votesToBlock) {
    resolved = 'rejected';
  } else if (tally.amend >= votesToBlock) {
    resolved = 'amended';
  }

  if (resolved) {
    // Atomically resolve — only first concurrent request wins
    const { rowCount } = await pool.query(
      `UPDATE board_decisions
       SET status = $1, decision = $2, decided_by = $3, decided_at = now(), resolved_at = now()
       WHERE id = $4 AND status = 'pending'`,
      [
        resolved,
        resolved === 'approved' ? 'proceed' : resolved === 'rejected' ? 'stop' : 'amend',
        `Board (${tally.proceed}/${tally.stop}/${tally.amend})`,
        boardDecision.id,
      ]
    );

    if (rowCount && rowCount > 0) {
      // Send resolution message to group
      const resolutionText = formatBoardResolution(resolved, boardDecision.deal_name, boardDecision.gate, tally);
      try {
        await sendTelegramMessage(resolutionText, replyToId);
      } catch (err) {
        console.error('[Telegram] Failed to send resolution:', err);
      }

      // Run agent to process the outcome
      let agentMessage: string;
      if (resolved === 'approved') {
        agentMessage = `Board APPROVED the G${boardDecision.gate} review for "${boardDecision.deal_name}" (${tally.proceed} proceed, ${tally.stop} stop, ${tally.amend} amend). Advance the deal to G${boardDecision.gate + 1}.`;
      } else if (resolved === 'rejected') {
        agentMessage = `Board REJECTED the G${boardDecision.gate} review for "${boardDecision.deal_name}" (${tally.proceed} proceed, ${tally.stop} stop, ${tally.amend} amend). Hold the deal at G${boardDecision.gate}. Notify the deal owner and document the block.`;
      } else {
        agentMessage = `Board requested AMENDMENTS for the G${boardDecision.gate} review of "${boardDecision.deal_name}" (${tally.proceed} proceed, ${tally.stop} stop, ${tally.amend} amend). Hold the deal and notify the owner that changes are needed.`;
      }

      try {
        for await (const event of runAgent(boardDecision.deal_id, agentMessage)) {
          if (event.type === 'error') {
            console.error(`Board resolution agent error for deal ${boardDecision.deal_id}:`, event.error);
          }
        }
      } catch (err) {
        console.error('Agent error on board resolution:', err);
      }
    }
  } else {
    // Not yet resolved — send tally update
    const tallyText = formatVoteTallyReply(voterName, vote, tally, votesRequired);
    try {
      await sendTelegramMessage(tallyText, replyToId);
    } catch (err) {
      console.error('[Telegram] Failed to send tally reply:', err);
    }
  }

  return NextResponse.json({
    ok: true,
    deal_id: boardDecision.deal_id,
    deal_name: boardDecision.deal_name,
    voter: voterName,
    vote,
    tally,
    resolved,
  });
}

/**
 * Route 3: free-text message in a private DM from a linked user →
 * dispatch to the Claude+MCP agent bridge, send reply back.
 *
 * If the sender isn't linked, we send a friendly nudge to /settings/telegram.
 * Non-linked users can't use the bot for read/write access — deliberate.
 */
async function handlePrivateChatMessage(
  chatId: number,
  telegramUserId: number,
  text: string,
): Promise<NextResponse> {
  const linked = await lookupTelegramLink(telegramUserId);
  if (!linked) {
    await sendChatMessage(chatId,
      `👋 You're not linked to a SalesBrain account yet.\n\n` +
      `Log in at https://salescrm.chipchip.social → Settings → Telegram → Generate linking code, ` +
      `then send me /start LINK-XXXXXX to connect.`
    ).catch(() => {});
    return NextResponse.json({ ok: true, handled: 'not_linked' });
  }

  // Fire the agent in the background so we don't hold Telegram's webhook
  // waiting for Claude. Telegram's timeout is ~60s, well within Claude's
  // response time, but returning 200 fast keeps us safely under it.
  (async () => {
    try {
      // Show "typing..." while we compute — best-effort, don't fail on it.
      try {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
        });
      } catch { /* ignore */ }

      const reply = await runAgentBridge(linked, text);
      await sendChatMessage(chatId, reply.text);
      console.log(`[Telegram] Agent reply to user ${linked.user_email}: ${reply.tool_calls} tool call(s), ${reply.duration_ms}ms`);
    } catch (err) {
      console.error('[Telegram] agent bridge failed:', err);
      await sendChatMessage(chatId, '⚠️ Something went wrong. Try again shortly.').catch(() => {});
    }
  })();

  return NextResponse.json({ ok: true, handled: 'agent_bridge' });
}

/**
 * Route 4: an @mention of the bot inside a group chat.
 *
 * - Linked users act with their SalesBrain identity (full read + write scope).
 * - Unlinked users are allowed ONLY in the allowlisted board chat
 *   (`TELEGRAM_BOARD_CHAT_ID`), and only for read-only tools. Everywhere else
 *   we reply with a short "link your account" nudge and stop.
 */
async function handleGroupMention(
  message: NonNullable<TelegramUpdate['message']>,
  text: string,
  botUsername: string,
): Promise<NextResponse> {
  const chatId = message.chat!.id;
  const fromId = message.from!.id;
  const firstName = message.from!.first_name || message.from!.username || 'there';

  // Strip @botname (all occurrences) and normalize whitespace.
  const cleaned = text.replace(new RegExp(`@${botUsername}\\b`, 'gi'), '').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    await sendChatMessage(chatId,
      `Hi ${firstName} — what would you like to know? Try "what's stuck at the board?" or "how's the pipeline?"`,
      { replyToMessageId: message.message_id },
    ).catch(() => {});
    return NextResponse.json({ ok: true, handled: 'group_mention_empty' });
  }

  if (!mentionAllowed(chatId, fromId)) {
    await sendChatMessage(chatId,
      `${firstName}, you're asking a lot — I'll pause for a minute so I don't spam the group.`,
      { replyToMessageId: message.message_id },
    ).catch(() => {});
    return NextResponse.json({ ok: true, handled: 'group_mention_rate_limited' });
  }

  // Resolve identity.
  const linked = await lookupTelegramLink(fromId);
  const boardChatId = process.env.TELEGRAM_BOARD_CHAT_ID
    ? Number(process.env.TELEGRAM_BOARD_CHAT_ID)
    : null;
  const inAllowedGroup = boardChatId !== null && chatId === boardChatId;

  if (!linked && !inAllowedGroup) {
    await sendChatMessage(chatId,
      `Hi ${firstName} — I don't know you here. DM me /start LINK-XXXXXX after generating a code at Settings → Telegram to link your SalesBrain account.`,
      { replyToMessageId: message.message_id },
    ).catch(() => {});
    return NextResponse.json({ ok: true, handled: 'group_mention_unlinked_outside_allowlist' });
  }

  // Fire-and-forget so we return 200 quickly under Telegram's ~60s webhook cap.
  (async () => {
    try {
      // Best-effort "typing…"
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
      }).catch(() => {});

      const reply = linked
        ? await runAgentBridge(linked, cleaned, { channel: 'group' })
        : await runAgentBridge(
            { kind: 'anonymous', telegram_first_name: firstName } as AnonymousCaller,
            cleaned,
            { channel: 'group' },
          );
      await sendChatMessage(chatId, reply.text, { replyToMessageId: message.message_id });
      console.log(`[Telegram] group mention reply (${linked ? linked.user_email : 'anonymous'}): ${reply.tool_calls} tool(s), ${reply.duration_ms}ms`);
    } catch (err) {
      console.error('[Telegram] group mention agent failed:', err);
      await sendChatMessage(chatId, '⚠️ Something went wrong. Try again shortly.', { replyToMessageId: message.message_id }).catch(() => {});
    }
  })();

  return NextResponse.json({ ok: true, handled: 'group_mention' });
}
