import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { runAgent } from '@/lib/agent';
import { sendTelegramMessage, formatVoteTallyReply, formatBoardResolution } from '@/lib/telegram';

interface TelegramUpdate {
  message?: {
    message_id: number;
    from?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
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

  if (!message?.text || !message.reply_to_message || !message.from) {
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
