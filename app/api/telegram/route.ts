import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { runAgent } from '@/lib/agent';

interface TelegramUpdate {
  message?: {
    message_id: number;
    from?: { first_name?: string; last_name?: string; username?: string };
    text?: string;
    reply_to_message?: { message_id: number };
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

  if (!message?.text || !message.reply_to_message) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const replyToId = message.reply_to_message.message_id;
  const senderName = [message.from?.first_name, message.from?.last_name]
    .filter(Boolean)
    .join(' ') || message.from?.username || 'Unknown';

  // Find the board decision by telegram message ID
  const { rows } = await pool.query(
    `SELECT bd.*, d.id as deal_id, d.name as deal_name
     FROM board_decisions bd
     JOIN deals d ON d.id = bd.deal_id
     WHERE bd.telegram_message_id = $1 AND bd.decision IS NULL`,
    [replyToId]
  );

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'No matching pending decision' });
  }

  const boardDecision = rows[0];
  const decision = parseDecision(message.text);

  if (!decision) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'Could not parse decision from text',
    });
  }

  // Update the board decision
  await pool.query(
    `UPDATE board_decisions
     SET decision = $1, decided_by = $2, decided_at = now()
     WHERE id = $3`,
    [decision, senderName, boardDecision.id]
  );

  // Re-run the agent with the board decision context
  const agentMessage = `Board member ${senderName} replied to the G${boardDecision.gate} review: "${message.text}". Decision: ${decision.toUpperCase()}. Process this board decision and update the deal accordingly.`;

  // Run agent (fire and forget for webhook response speed, but collect events)
  const events: unknown[] = [];
  try {
    for await (const event of runAgent(boardDecision.deal_id, agentMessage)) {
      events.push(event);
    }
  } catch (err) {
    console.error('Agent error on telegram webhook:', err);
  }

  return NextResponse.json({
    ok: true,
    deal_id: boardDecision.deal_id,
    deal_name: boardDecision.deal_name,
    decision,
    decided_by: senderName,
    agent_events: events.length,
  });
}
