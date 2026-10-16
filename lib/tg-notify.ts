/**
 * Say something in a person's Telegram chat from the app (a connect link finished, a long import is done).
 * Uses the app's own bot token, which is the shared CRM bot. Plain text on purpose: no markup to get wrong.
 * Never throws: a failed notice must not fail the thing it reports on.
 */
export async function sendTelegram(chatId: string | number | null | undefined, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3900), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
