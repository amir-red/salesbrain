import { GATES } from './gates';

const TELEGRAM_API = 'https://api.telegram.org/bot';

interface TelegramResponse {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
}

/**
 * Send a message to an arbitrary chat_id via the bot. Used for direct
 * messages to individual users (personal SalesBrain bot flow) and for the
 * board group. Throws on any Telegram-side error.
 */
export async function sendChatMessage(
  chatId: number | string,
  text: string,
  opts?: { replyToMessageId?: number; parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML' },
): Promise<{ messageId: number }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN must be set');

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (opts?.replyToMessageId) body.reply_to_message_id = opts.replyToMessageId;
  if (opts?.parseMode) body.parse_mode = opts.parseMode;

  const url = `${TELEGRAM_API}${token}/sendMessage`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Telegram network error: ${err instanceof Error ? err.message : 'fetch failed'}`);
  }

  if (!res.ok) {
    const rawBody = await res.text();
    throw new Error(`Telegram HTTP ${res.status}: ${rawBody}`);
  }

  const data = (await res.json()) as TelegramResponse;
  if (!data.ok) throw new Error(`Telegram API: ${data.description}`);
  return { messageId: data.result!.message_id };
}

export async function sendTelegramMessage(text: string, replyToMessageId?: number): Promise<{ messageId: number }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_BOARD_CHAT_ID;

  if (!token || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_BOARD_CHAT_ID must be set');
  }

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };

  if (replyToMessageId) {
    body.reply_to_message_id = replyToMessageId;
  }

  const url = `${TELEGRAM_API}${token}/sendMessage`;

  console.log('[Telegram] Sending message to chat:', chatId);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[Telegram] Network error:', err);
    throw new Error(`Telegram network error: ${err instanceof Error ? err.message : 'fetch failed'}`);
  }

  if (!res.ok) {
    const rawBody = await res.text();
    console.error(`[Telegram] HTTP ${res.status} ${res.statusText}:`, rawBody);
    throw new Error(`Telegram HTTP error ${res.status}: ${rawBody}`);
  }

  let data: TelegramResponse;
  try {
    data = await res.json();
  } catch {
    console.error('[Telegram] Failed to parse response JSON');
    throw new Error('Telegram returned invalid JSON');
  }

  if (!data.ok) {
    console.error('[Telegram] API error:', data.description);
    throw new Error(`Telegram API error: ${data.description}`);
  }

  console.log('[Telegram] Message sent successfully, message_id:', data.result!.message_id);
  return { messageId: data.result!.message_id };
}

// ─── Board Review Message Formatting ────────────────────────────

export interface BoardReviewDeal {
  name: string;
  company: string;
  value: string | null;
  currency: string;
  score: number | null;
  risk: string | null;
  verdict: string | null;
  gate: number;
  lead_name: string | null;
}

export function formatBoardReviewMessage(deal: BoardReviewDeal, summary: string): string {
  const gate = GATES[deal.gate - 1];
  const gateName = gate?.name || `Gate ${deal.gate}`;

  const gateProgress = GATES.map((g) => {
    if (g.number < deal.gate) return `G${g.number} done`;
    if (g.number === deal.gate) return `[G${g.number}]`;
    return `G${g.number}`;
  }).join('  ');

  const valueStr = deal.value ? `${deal.currency} ${Number(deal.value).toLocaleString()}` : 'Not set';
  const scoreStr = deal.score !== null ? `${deal.score}/100` : 'N/A';
  const riskStr = deal.risk ? deal.risk.toUpperCase() : 'N/A';
  const verdictStr = deal.verdict ? deal.verdict.replace(/_/g, ' ') : 'N/A';
  const leadStr = deal.lead_name || 'Unassigned';

  const lines = [
    `BOARD REVIEW — ${gateName}`,
    '',
    `Deal: ${deal.name}`,
    `Company: ${deal.company}`,
    `Value: ${valueStr}`,
    `Score: ${scoreStr} | Risk: ${riskStr} | Verdict: ${verdictStr}`,
    `Lead: ${leadStr}`,
    '',
    gateProgress,
    '',
    `Summary:`,
    summary,
    '',
    'Reply to this message with:',
    'proceed / stop / amend',
    '',
    'Votes needed: 5 of 8 to proceed',
  ];

  return lines.join('\n');
}

export function formatVoteTallyReply(
  voterName: string,
  vote: string,
  tally: { proceed: number; stop: number; amend: number },
  votesRequired: number
): string {
  return [
    `${voterName} voted: ${vote}`,
    `Tally: ${tally.proceed} proceed / ${tally.stop} stop / ${tally.amend} amend (${votesRequired} needed)`,
  ].join('\n');
}

export function formatBoardResolution(
  status: 'approved' | 'rejected' | 'amended',
  dealName: string,
  gate: number,
  tally: { proceed: number; stop: number; amend: number }
): string {
  if (status === 'approved') {
    return `APPROVED: "${dealName}" passed G${gate} board review (${tally.proceed} proceed, ${tally.stop} stop, ${tally.amend} amend). Deal advances.`;
  } else if (status === 'rejected') {
    return `BLOCKED: "${dealName}" G${gate} board review rejected (${tally.proceed} proceed, ${tally.stop} stop, ${tally.amend} amend). Deal held.`;
  } else {
    return `AMEND REQUESTED: "${dealName}" G${gate} board review needs amendments (${tally.proceed} proceed, ${tally.stop} stop, ${tally.amend} amend).`;
  }
}
