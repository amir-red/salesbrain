const TELEGRAM_API = 'https://api.telegram.org/bot';

interface TelegramResponse {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
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
    // No parse_mode — plain text is safest. Telegram's Markdown parser
    // rejects messages with unescaped special characters like _ * [ etc.
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
