/**
 * The Inbox contract (client-safe): one list of outreach conversations across email, LinkedIn and chats, and one
 * conversation with its messages. Server queries live in lib/inbox-server.ts; the store is core migration 082
 * (email_threads / email_messages), the LinkedIn mirror (linkedin_threads / linkedin_messages) and core 100
 * (chat_threads / chat_messages: WhatsApp, iMessage, Telegram read through a Zeami link, WhatsApp through Unipile,
 * or pushed from a Mac).
 */

export type InboxChannel = 'email' | 'linkedin' | 'chat';
/** Which app a chat came through (channel 'chat' only). */
export type ChatApp = 'whatsapp' | 'whatsapp_business' | 'imessage' | 'telegram' | 'sms';
export type InboxState = 'needs_reply' | 'waiting' | 'done' | 'ignored';
export type InboxFilter = 'all' | 'needs_reply' | 'unread' | 'planned' | 'done';

/** A conversation plan (core 103): what the owner decided when no reply was needed. Summary on every list row. */
export interface PlanSummary {
  id: string;
  decision: 'follow_up' | 'leave';
  reason_kind: string;
  next_due_at: string | null;
  steps_left: number;
}
export interface PlanStep { n: number; due_at: string; purpose: string; status: 'pending' | 'filed' | 'notified' | 'sent' | 'skipped' | 'cancelled'; approval_id?: string; note?: string }
export interface ConversationPlan {
  id: string; decision: 'follow_up' | 'leave'; reason_kind: string; reason_label: string; reason: string | null;
  steps: PlanStep[]; next_due_at: string | null; status: 'active' | 'done' | 'cancelled'; created_at: string; took_suggestion: boolean | null;
}
export interface PlanSuggestion {
  decision: 'answer' | 'follow_up' | 'leave'; reason_kind: string | null; days: number | null;
  steps: { days: number; purpose: string }[]; why: string; from_history: boolean;
  signal: { kind: string | null; days: number | null; quote: string | null };
}
export interface PlanPayload {
  plan: ConversationPlan | null; suggestion: PlanSuggestion; habit: { n?: number; follow_up?: number; leave?: number; median_days?: number | null };
  reasons: { key: string; label: string; follow_up: boolean }[]; max_steps: number; has_prospect: boolean; has_card: boolean;
}

/** One channel thread inside a person's conversation (the list row and the person view both carry them). */
export interface InboxThreadRef {
  channel: InboxChannel;
  id: string;
  app?: ChatApp | null;
  state: InboxState;
  unread: boolean;
  last_message_at: string | null;
  last_from_them: boolean;
  subject?: string | null;
  mailbox?: string | null;
  plan?: PlanSummary | null;
}

/**
 * One list row = one PERSON (2026-11-09): every channel thread we hold with them, folded on the group key
 * `person:<person_id>` (else `prospect:<prospect_id>`, else the thread's own `<channel>:<id>` for strangers).
 * `channel` / `id` / `subject` / `app` / `mailbox` are the newest thread's; `state` is needs_reply when any thread
 * needs one; `unread` when any is; `plan` = the newest thread's plan.
 */
export interface InboxItem {
  /** the group key: what the page opens (?c=) and what rows are keyed on */
  key: string;
  /** every channel in the conversation, newest first */
  channels: InboxChannel[];
  threads: InboxThreadRef[];
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
  person_id: string | null;
  sales_lead_id: string | null;
  campaign_name: string | null;
  /** chat only */
  app?: ChatApp | null;
  /** email only: which of the owner's mailboxes the thread is in (core 102) */
  mailbox?: string | null;
  /** the active conversation plan, when there is one (core 103) */
  plan?: PlanSummary | null;
}

export interface InboxCounts { needs_reply: number; unread: number; planned: number; email: number; linkedin: number; chat: number }

/** A file on a message (core 104): ours as sent, or theirs (fetched from Gmail / Unipile when opened). */
export interface InboxAttachment {
  name: string;
  mime: string | null;
  size: number | null;
  /** download link (`?inline=1` shows an image in the page) */
  url: string;
  image: boolean;
  /** the provider no longer has it (an expired WhatsApp media file) */
  unavailable?: boolean;
}

export interface InboxMessage {
  id: string;
  /** null = who wrote it is unknown (WhatsApp read by Zeami on a Mac) */
  from_me: boolean | null;
  /** chat only: Zeami gave no sender */
  sender_unknown?: boolean;
  /** chat only, group chats (core 106): who in the group wrote it */
  sender_name?: string;
  /** chat only: Zeami gave no time; sent_at is when we read it */
  read_time?: boolean;
  text: string;
  sent_at: string | null;
  /** email only */
  from?: string | null;
  subject?: string | null;
  /** a reply typed here that the send gate holds (quiet hours, a cap) */
  pending?: boolean;
  /** files on the message (core 104) */
  attachments?: InboxAttachment[];
  /** which thread the message came through (every message carries it; the icon on the bubble) */
  channel: InboxChannel;
  app?: ChatApp | null;
  thread_id: string;
}

/** One thread a reply can go into: the pills above the reply box. */
export interface ReplyTarget {
  channel: InboxChannel;
  id: string;
  app?: ChatApp | null;
  label: string;
  can_reply: boolean;
  /** your own chat that cannot be sent from here (iMessage, the Zeami link): draft, copy, send in the app */
  copy_only: boolean;
  reply_note: string | null;
  last_from_them: boolean;
  last_message_at: string | null;
  state: InboxState;
  plan?: PlanSummary | null;
  mailbox?: string | null;
  subject?: string | null;
  open_url?: string | null;
  profile_url?: string | null;
  mine: boolean;
}

export interface InboxThread extends InboxItem {
  profile_url: string | null;
  mailbox: string | null;
  messages: InboxMessage[];
  can_reply: boolean;
  /** why not, when can_reply is false */
  reply_note: string | null;
  prospect_stage: string | null;
  /** one per thread of the person; `default_target` = where they last wrote and we can answer */
  targets: ReplyTarget[];
  default_target: string | null;
  /** chat only: Zeami keeps just the last message of this conversation (history builds up one sync at a time) */
  only_last_message?: boolean;
  /** chat only: open the conversation in its own app */
  open_url?: string | null;
  /** chat only: where it was read from, in words */
  source_note?: string | null;
  /** the viewer owns this conversation */
  mine?: boolean;
}

export const CHANNEL_LABEL: Record<InboxChannel, string> = { email: 'Email', linkedin: 'LinkedIn', chat: 'Chats' };

export const APP_LABEL: Record<ChatApp, string> = {
  whatsapp: 'WhatsApp', whatsapp_business: 'WhatsApp Business', imessage: 'iMessage', telegram: 'Telegram', sms: 'SMS',
};

/** The label for one conversation's channel: the app for a chat. */
export function channelLabel(it: { channel: InboxChannel; app?: ChatApp | null }): string {
  return it.channel === 'chat' && it.app ? APP_LABEL[it.app] : CHANNEL_LABEL[it.channel];
}

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

/** `<channel>:<id>` — the key of one thread (reply targets, drafts kept in the browser, the plan panel). */
export function threadKey(t: { channel: InboxChannel; id: string }): string {
  return `${t.channel}:${t.id}`;
}

/** A key the page can open: a person's conversation (`person:` / `prospect:`, or the same address / LinkedIn member
 *  of a stranger: `em:` / `li:`) or one thread (`email:` …). */
export function parseKey(key: string): { kind: 'person' | 'prospect' | 'same' | 'thread' | 'accepted'; channel?: InboxChannel; id: string } | null {
  const i = key.indexOf(':');
  if (i < 1) return null;
  const head = key.slice(0, i), id = key.slice(i + 1);
  if (!id) return null;
  if (head === 'person' || head === 'prospect' || head === 'accepted') return { kind: head, id };
  if (head === 'em' || head === 'li') return { kind: 'same', id };
  if (head === 'email' || head === 'linkedin' || head === 'chat') return { kind: 'thread', channel: head, id };
  return null;
}
