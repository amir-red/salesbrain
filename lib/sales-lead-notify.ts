/**
 * Telegram heads-up to the board group ("Sales Pipeline Zeami/Grant/CC") when a
 * sales lead lands from zeami.io (ads → Request Demo form → Calendly).
 *
 * Three moments, one message each:
 *   - 'submitted'      — the zeami.io form row was inserted
 *   - 'booked'         — Calendly confirmed a slot for a lead we already had
 *   - 'booked_direct'  — Calendly booking with no prior form row (new lead)
 *
 * Fire-and-forget: never throws — the lead row has already been persisted.
 */

import { sendChatMessage } from './telegram';

export type SalesLeadEvent = 'submitted' | 'booked' | 'booked_direct';

export interface SalesLeadNotice {
  event: SalesLeadEvent;
  fullName: string;
  company: string;
  email: string;
  website?: string | null;
  description?: string | null;
  source?: string | null;
  preferredSlot?: string | null;   // "2026-10-14 09:00 Africa/Nairobi" (form)
  bookedSlot?: string | null;      // formatted Calendly slot
  meetLink?: string | null;
}

const HEADINGS: Record<SalesLeadEvent, string> = {
  submitted: '🆕 <b>New sales lead</b>',
  booked: '📅 <b>Demo booked</b>',
  booked_direct: '🆕📅 <b>New sales lead — demo booked</b>',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatSalesLeadNotice(n: SalesLeadNotice): string {
  const lines = [
    HEADINGS[n.event],
    '',
    `<b>${esc(n.fullName || 'Unknown')}</b> — ${esc(n.company || 'Unknown')}`,
    `✉️ ${esc(n.email)}`,
  ];
  if (n.website) lines.push(`🌐 ${esc(n.website)}`);
  if (n.bookedSlot) lines.push(`🗓 ${esc(n.bookedSlot)}`);
  else if (n.preferredSlot) lines.push(`🗓 preferred: ${esc(n.preferredSlot)}`);
  if (n.meetLink) lines.push(`🔗 ${esc(n.meetLink)}`);
  if (n.description) {
    const d = n.description.length > 500 ? `${n.description.slice(0, 500)}…` : n.description;
    lines.push('', `<i>${esc(d)}</i>`);
  }
  if (n.source) lines.push('', `source: ${esc(n.source)}`);
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://salescrm.chipchip.social';
  lines.push(`<a href="${base}/sales-leads">Open /sales-leads</a>`);
  return lines.join('\n');
}

export async function notifySalesLead(n: SalesLeadNotice): Promise<void> {
  const chatId = process.env.TELEGRAM_BOARD_CHAT_ID;
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) {
    console.warn('[sales-lead-notify] TELEGRAM_BOT_TOKEN / TELEGRAM_BOARD_CHAT_ID not set — skipped');
    return;
  }
  try {
    await sendChatMessage(chatId, formatSalesLeadNotice(n), { parseMode: 'HTML' });
  } catch (err) {
    console.error('[sales-lead-notify] Telegram send failed:', err instanceof Error ? err.message : err);
  }
}
