/**
 * The Inbox contract (client-safe): one list of outreach conversations across email and LinkedIn, and one
 * conversation with its messages. Server queries live in lib/inbox-server.ts; the store is core migration 082
 * (email_threads / email_messages) plus the LinkedIn mirror (linkedin_threads / linkedin_messages).
 */

export type InboxChannel = 'email' | 'linkedin';
export type InboxState = 'needs_reply' | 'waiting' | 'done' | 'ignored';
export type InboxFilter = 'all' | 'needs_reply' | 'unread' | 'done';

export interface InboxItem {
  channel: InboxChannel;
  id: string;
  owner_user_id: string;
  owner_name: string | null;
  name: string | null;
  headline: string | null;
  company: string | null;
  email: string | null;
  subject: string | null;
  snippet: string | null;
  last_message_at: string | null;
  last_from_them: boolean;
  state: InboxState;
  unread: boolean;
  prospect_id: string | null;
  sales_lead_id: string | null;
  campaign_name: string | null;
}

export interface InboxCounts { needs_reply: number; unread: number; email: number; linkedin: number }

export interface InboxMessage {
  id: string;
  from_me: boolean;
  text: string;
  sent_at: string | null;
  /** email only */
  from?: string | null;
  subject?: string | null;
  /** a reply typed here that the send gate holds (quiet hours, a cap) */
  pending?: boolean;
}

export interface InboxThread extends InboxItem {
  profile_url: string | null;
  mailbox: string | null;
  messages: InboxMessage[];
  can_reply: boolean;
  /** why not, when can_reply is false */
  reply_note: string | null;
  prospect_stage: string | null;
}

export const CHANNEL_LABEL: Record<InboxChannel, string> = { email: 'Email', linkedin: 'LinkedIn' };

/** "3 min" / "2 h" / "Yesterday" / "12 Oct" — compact time for the list. */
export function shortWhen(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const min = Math.round((now - t) / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const d = new Date(iso);
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
}

export function initials(name: string | null | undefined): string {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
