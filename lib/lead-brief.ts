/**
 * The lead brief (2026-11-09): the eight answers a person page gives — the shape the kernel's `lead_brief` returns
 * (salesbrain-core commands/lead_brief.py). Client-safe: types and small helpers only.
 */

export interface BriefChannel {
  channel: 'linkedin' | 'email' | 'whatsapp' | 'imessage' | 'telegram' | 'sms' | 'meeting';
  label: string;
  thread_id?: string | null;
  owner_user_id?: string | null;
  owner_name: string | null;
  last_at: string | null;
  last_from_them: boolean;
  needs_reply?: boolean;
  state?: string | null;
  count: number;
  last_text?: string | null;
  text?: string | null;            // a met / call entry
  kind?: 'meeting';
  inbox_key?: string | null;        // linkedin:<id> · email:<id> · chat:<id>
  subject?: string | null;
  mailbox?: string | null;
  can_reply?: boolean;
}
export interface BriefMessage { ours: boolean | null; text: string | null; sent_at: string | null }
export interface BriefConversation extends BriefChannel { messages: BriefMessage[] }
export interface OpenItem { side: 'us' | 'them'; kind: 'question' | 'promise' | 'plan' | 'draft' | 'timer'; item: string; since?: string | null }
export interface DatedFact { date: string; fact: string; kind: string; source_url: string; source_title?: string }

export interface LeadBrief {
  prospect_id: string; person_id: string | null; card_id: string | null;
  owner: { user_id: string | null; name: string | null };
  list: { id: string | null; name: string | null; cohort: string | null };
  stage: string; priority: number | null; converted_deal_id: string | null;
  trust: { total: number | null; parts: Record<string, number> | null; why: string | null; kind: string; via: string | null;
           value_to_us: string | null; multiplier: number | null; held: number | null };
  stand: {
    state: 'never' | 'they_wrote' | 'we_wrote' | 'met'; channel: string | null; days: number | null; line: string;
    channels: BriefChannel[]; open_items: OpenItem[]; language: 'de' | 'en' | null; address: 'du' | 'Sie' | null;
    sent_count: number; last_sent_at: string | null; last_reply_at: string | null;
  };
  conversations: BriefConversation[];
  person: {
    name: string | null; title: string | null; location: string | null; picture_url: string | null; headline: string | null;
    linkedin_url: string | null; email: string | null; phone: string | null; background: string | null; mandate: string | null;
    tenure_months: number | null; prior_roles: string[]; posts_topics: string[]; signals: string[]; role_confirmed: boolean | null;
    employers: string[]; schools: string[]; as_of: string | null;
  };
  company: {
    name: string | null; domain: string | null; website: string | null; industry: string | null; size: string | null;
    revenue: string | null; year: string | null; ownership: string | null; funding: string | null; hq: string | null;
    aims: string | null; summary: string | null; signals: string[]; source_url: string | null; as_of: string | null;
  };
  /** notes = undated signals from the company research ("active hiring"), shown when there is no dated fact */
  why_now: { facts: DatedFact[]; signals: string[]; legacy: string | null; notes?: string[]; as_of: string | null };
  /** talking_points: a list (company research) or one text (research brief); pains: likely pains, short lines */
  gains: { angle: string | null; why: string | null; partner: Record<string, string>; talking_points: string | string[] | null; pains?: string[]; as_of: string | null };
  who_in: {
    kind: string; via: string | null; hops: number | null; line: string;
    connected: { owner_user_id: string; owner: string | null; status: 'connected' | 'pending'; since: string | null }[];
    warm_with: { teammate: string; band: string; reasons: string[]; last_two_way_at: string | null }[];
    mutual: number; connector: boolean | null;
    route: { computed_at: string | null; path_available: boolean; best_path_hops: number | null; via: (string | null)[];
             bridges: { name: string | null; evidence: string | null; is_blue: boolean | null }[]; note?: string | null } | null;
  };
  how: { channel: string | null; why: string; language: string | null; language_from: string | null; address: string | null; address_from: string | null };
  next_step: {
    set: string | null; ping_at: string | null; suggested: { code: string; label: string; why: string } | null;
    lifecycle: { stage: string | null; step: string | null }; responsible: string | null; front: string | null;
    booked_at: string | null; booking_status: string | null;
  };
  waiting: { id: string; kind: string; channel: string; status: string; message: string | null; created_at: string; owner_name: string | null; owner_user_id: string }[];
  plans: { id: string; channel: string; thread_id: string; decision: string; reason_kind: string; reason: string | null; steps: { n: number; due_at: string; purpose: string; status: string }[]; next_due_at: string | null }[];
  research: { at: string | null; tier: string | null; sources: { url: string; title?: string }[]; has_extras: boolean };
  generated_at: string;
}

export function initialsOf(name: string | null | undefined): string {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** "today" / "yesterday" / "12 days ago" / "3 months ago" for an ISO stamp. */
export function agoLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const d = Math.max(0, Math.round((now - new Date(iso).getTime()) / 86_400_000));
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  if (d < 365) { const m = Math.round(d / 30); return m <= 1 ? 'a month ago' : `${m} months ago`; }
  const y = Math.round(d / 365);
  return y <= 1 ? 'a year ago' : `${y} years ago`;
}

export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}

export const FACT_KIND_LABEL: Record<string, string> = {
  role_change: 'New role', hiring: 'Hiring', funding: 'Funding', ownership: 'Ownership', expansion: 'Expansion',
  product: 'Product', award: 'Award', event: 'Event', post: 'Post', other: 'News',
};

export const SIGNAL_LABEL: Record<string, string> = {
  new_in_role: 'new in role', entrepreneurial: 'entrepreneurial background', interim_or_exit_mandate: 'interim / exit mandate',
  posts_on_ai: 'posts on AI', modernisation_mandate: 'modernisation mandate',
};

/** The one-line meaning of a research freshness stamp. */
export function asOf(iso: string | null | undefined): string {
  return iso ? `as of ${dayLabel(iso)}` : 'not researched yet';
}
