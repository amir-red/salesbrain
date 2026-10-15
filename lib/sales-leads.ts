/**
 * /sales-leads — the team's lead dashboard. Contract shared by the page, the
 * API routes and the Napa import. Pure: no DB, client-safe.
 *
 * Design (Mateo + Amir, 2026-10-13, from Mateo's PEI Napa CRM): one line per
 * lead, an editable priority (1 = top) and a "must talk" star that sort the
 * list, a "N days since we last talked" ticker and a "ping again on" date,
 * who is responsible (back office drives, front office is the face in calls),
 * where we met, a short dossier, and a dated track record.
 */

export type LeadStatus = 'new' | 'contacted' | 'replied' | 'converted' | 'archived';
export type LeadView = 'working' | 'due' | 'must' | LeadStatus | 'all';
export type LeadSort = 'priority' | 'contact' | 'newest';

export const EVENT_KINDS = ['met', 'sent', 'reply', 'call', 'meeting', 'note', 'status', 'priority', 'assign', 'import'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
/** Kinds the user can add by hand; `note` is bookkeeping, the rest are contacts. */
export const MANUAL_EVENT_KINDS: { kind: EventKind; label: string; contact: boolean }[] = [
  { kind: 'note', label: 'Note', contact: false },
  { kind: 'call', label: 'Call', contact: true },
  { kind: 'meeting', label: 'Meeting', contact: true },
  { kind: 'met', label: 'Met (event)', contact: true },
  { kind: 'sent', label: 'Sent a message', contact: true },
  { kind: 'reply', label: 'They replied', contact: true },
];
export const CHANNELS = ['linkedin', 'email', 'phone', 'in_person', 'telegram', 'whatsapp'] as const;
export type Channel = (typeof CHANNELS)[number];

export interface Dossier {
  tier?: string;                // High | Medium | Lower (Napa)
  speaker?: boolean;
  talking_points?: string[];    // recent news to open with
  relevance?: string;           // why this person matters to us
  firm_summary?: string;
  chronology?: string[];        // CV lines, "Education: …" rendered muted
  interesting?: string;
  sources?: string[];
  confidence?: string;
}

export interface LeadEvent {
  id: string;
  occurred_at: string;
  kind: EventKind;
  channel: string | null;
  text: string;
  actor_name: string | null;
  ref: Record<string, unknown> | null;
}

export interface Lead {
  id: string;
  full_name: string;
  title: string | null;
  company: string;
  email: string;
  website: string | null;
  linkedin_url: string | null;
  description: string | null;
  notes: string | null;
  dossier: Dossier | null;
  source: string;
  status: LeadStatus;
  priority: number | null;
  rank: number | null;                 // order inside the priority (059); null = unordered
  must_talk: boolean;
  met_at: string | null;
  responsible_user_id: string | null;
  responsible_name: string | null;
  front_user_id: string | null;
  front_name: string | null;
  last_contact_at: string | null;      // newest contact event; null = never
  next_contact_at: string | null;      // YYYY-MM-DD
  days_since_contact: number | null;   // from last_contact_at, else created_at
  created_at: string;
  converted_at: string | null;
  converted_deal_id: string | null;
  converted_deal_name: string | null;
  converted_deal_gate: number | null;
  prospect_id: string | null;
  icp_name: string | null;
  cards_pending: number;               // approval cards awaiting the owner's 👍
  booking_status: 'scheduled' | 'canceled' | 'no_show' | null;
  booked_at: string | null;
  meet_link: string | null;
  preferred_demo_date: string | null;
  preferred_demo_time: string | null;
  preferred_demo_timezone: string | null;
  last_event: { kind: EventKind; text: string; occurred_at: string } | null;
}

export interface LeadCounts {
  working: number; due: number; must: number;
  new: number; contacted: number; replied: number; converted: number; archived: number; all: number; booked: number;
}

export interface TeamUser { id: string; name: string; email: string }

/** Thresholds for the ticker colour: quiet for 14 days = amber, 30 = red. */
export const QUIET_WARN_DAYS = 14;
export const QUIET_ALERT_DAYS = 30;

export function contactAge(lead: Pick<Lead, 'days_since_contact' | 'last_contact_at'>): { label: string; short: string; tone: 'ok' | 'warn' | 'alert' | 'never' } {
  if (!lead.last_contact_at) return { label: 'never talked', short: '—', tone: 'never' };
  const d = lead.days_since_contact ?? 0;
  const label = d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`;
  const short = d <= 0 ? 'today' : `${d} d`;
  return { label, short, tone: d >= QUIET_ALERT_DAYS ? 'alert' : d >= QUIET_WARN_DAYS ? 'warn' : 'ok' };
}

/** "ping again on" relative to today: overdue / today / in N days. */
export function nextContactLabel(ymd: string | null): { label: string; overdue: boolean } | null {
  if (!ymd) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(`${ymd}T00:00:00`);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { label: `overdue ${-diff}d`, overdue: true };
  if (diff === 0) return { label: 'ping today', overdue: true };
  if (diff === 1) return { label: 'ping tomorrow', overdue: false };
  return { label: `ping in ${diff}d`, overdue: false };
}

export function addDays(ymd: string | null, days: number): string {
  const base = ymd ? new Date(`${ymd}T00:00:00`) : new Date();
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${base.getFullYear()}-${p(base.getMonth() + 1)}-${p(base.getDate())}`;
}

/** 1 = top … 10 (core 059). Colour fades with the number; the label is the number itself. */
const PRIORITY_COLORS = ['var(--red)', 'var(--red)', 'var(--orange)', 'var(--orange)', 'var(--yellow)', 'var(--yellow)', 'var(--cat-teal)', 'var(--cat-teal)', 'var(--text-muted)', 'var(--text-muted)'];
export const PRIORITY_LEVELS: { value: number; label: string; short: string; color: string }[] =
  PRIORITY_COLORS.map((color, i) => ({ value: i + 1, label: `P${i + 1}${i === 0 ? ' · top' : i === 9 ? ' · lowest' : ''}`, short: `P${i + 1}`, color }));
export function priorityLevel(p: number | null | undefined) {
  return p ? PRIORITY_LEVELS.find((l) => l.value === p) ?? PRIORITY_LEVELS[9] : null;
}

/** Napa research tiers came as A/B/C or High/Medium/Lower; show one vocabulary. */
export function tierLabel(t: string | null | undefined): string | null {
  if (!t) return null;
  return ({ A: 'High fit', B: 'Medium fit', C: 'Lower fit', High: 'High fit', Medium: 'Medium fit', Lower: 'Lower fit' } as Record<string, string>)[t] ?? t;
}

export function firstName(name: string | null | undefined): string {
  return (name || '').split(/\s+/)[0] || '';
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('');
}

export const STATUS_COLOR: Record<LeadStatus, string> = {
  new: 'var(--accent)',
  contacted: 'var(--yellow)',
  replied: 'var(--cat-teal)',
  converted: 'var(--green)',
  archived: 'var(--text-muted)',
};

/** Lead roles (core 058, policy/lead_roles.py) — the seats on every lead and what each one owns. */
export type LeadRole = 'responsible' | 'front';
export type RoleFilter = '' | 'any' | LeadRole;   // '' = everyone's leads
export const ROLES: Record<LeadRole, { label: string; short: string; duties: string; hears: string }> = {
  responsible: {
    label: 'Back office', short: 'back',
    duties: 'Drives the lead: research and the dossier, drafts, follow-ups, the ping-by date, priority, the track record.',
    hears: 'Morning digest of due leads, reply notices, new leads.',
  },
  front: {
    label: 'Front office', short: 'front',
    duties: 'The face: calls, demos and meetings. Becomes the deal\'s project lead when the lead converts. Empty = the back office does both.',
    hears: 'Booking notices and the day\'s demos.',
  },
};
export function effectiveFront(lead: Pick<Lead, 'responsible_user_id' | 'front_user_id'>): string | null {
  return lead.front_user_id ?? lead.responsible_user_id;
}
export function myRole(lead: Pick<Lead, 'responsible_user_id' | 'front_user_id'>, userId: string | null): LeadRole | null {
  if (!userId) return null;
  if (lead.responsible_user_id === userId) return 'responsible';
  if (lead.front_user_id === userId) return 'front';
  return null;
}
