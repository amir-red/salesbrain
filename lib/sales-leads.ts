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
export type LeadView = 'working' | 'due' | 'must' | 'needs_you' | LeadStatus | 'all';
export type LeadSort = 'priority' | 'contact' | 'newest';

/**
 * The stored lifecycle of a lead (core 068, policy/lifecycle.py): where it is, who has to move next, and one
 * human sentence. The Lead Conductor writes these columns every hour; the app only READS them, so there is no second
 * copy of the rules to drift. The labels below mirror the kernel's LABELS / FUNNEL (core tests/test_lifecycle_parity
 * fails when they differ).
 */
export type LifecycleActor = 'system' | 'you' | 'them' | 'none';
export const LIFECYCLE_LABELS = {
  landed: 'Setting up', finding_profile: 'Finding LinkedIn', needs_pick: 'Pick a profile',
  no_linkedin: 'No LinkedIn', ready_to_connect: 'Ready to connect', request_filed: 'Approve request',
  request_pending: 'Request sent', connected: 'Connected', first_message_waiting: 'Approve message',
  messaged: 'Messaged', followup_due: 'Follow-up due', followup_waiting: 'Approve follow-up',
  email_path: 'By email', stalled: 'Stalled', replied: 'Replied', call_set: 'Call set',
  in_conversation: 'In conversation', paused: 'Paused', done: 'Done',
} as const;
export type LifecycleStage = keyof typeof LIFECYCLE_LABELS;
/** Order of the funnel strip on the page (every stage a working lead can be in). */
export const LIFECYCLE_FUNNEL: LifecycleStage[] = [
  'landed', 'finding_profile', 'needs_pick', 'no_linkedin', 'ready_to_connect', 'request_filed', 'request_pending',
  'connected', 'first_message_waiting', 'messaged', 'followup_due', 'followup_waiting', 'email_path', 'stalled',
  'replied', 'call_set', 'in_conversation', 'paused',
];
export const LIFECYCLE_BLOCKERS: Record<string, string> = {
  needs_sender_account: 'Nobody on this lead\'s team has a LinkedIn account connected to send from. Connect one on Profile, or set a default sender.',
  account_paused: 'The LinkedIn account that sends for this lead is paused after errors. Resume it on the Agents page.',
  caps_reached: 'Today\'s or this week\'s connection-request limit is used. The lead goes into the next batch.',
  no_reach: 'No LinkedIn profile and no email: there is nothing to reach them with yet.',
};
export const ACTOR_STYLE: Record<LifecycleActor, { label: string; color: string }> = {
  system: { label: 'Automatic', color: 'var(--accent)' },
  you: { label: 'Needs you', color: 'var(--orange)' },
  them: { label: 'Waiting for them', color: 'var(--cat-teal)' },
  none: { label: '', color: 'var(--text-muted)' },
};
/** Stages where the person must act, for the Needs you view (mirrors the digest in commands/conductor.needs_you). */
export const NEEDS_YOU_EXCLUDED: LifecycleStage[] = ['paused', 'in_conversation', 'call_set'];

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

/** The lead's journey on the card (migration 060). Index = journey_stage; 0 = not started. */
export const JOURNEY_STAGES: { stage: number; label: string; hint: string }[] = [
  { stage: 1, label: 'Warm introduction', hint: 'Someone introduced us (rate the intro 1–5)' },
  { stage: 2, label: 'Connected on LinkedIn', hint: 'Request accepted / in touch on LinkedIn' },
  { stage: 3, label: 'Other channel', hint: 'WhatsApp, email or phone exchanged' },
  { stage: 4, label: 'Call or meeting set', hint: 'A date is in the calendar' },
  { stage: 5, label: 'Qualified', hint: 'Into the sales funnel (convert) — or lost' },
];
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
  actor_user_id?: string | null;
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
  next_step: string | null;            // the next envisioned step, free text (061)
  phone: string | null;                // 062
  // LinkedIn signals from the lead's prospect + newest request (null for a lead with no prospect behind it)
  li_public_id: string | null;
  li_degree: string | null;
  li_invite_status: string | null;
  li_invite_sent_at: string | null;
  li_accepted_at: string | null;
  connect_waiting: boolean;            // a connection request is filed and waits for the owner's 👍
  sent_count: number;                  // 'sent' lines on the track record
  last_sent_at: string | null;
  last_reply_at: string | null;
  journey_stage: number;               // 0 … 5 (060)
  intro_quality: number | null;        // 1 … 5
  journey_outcome: 'qualified' | 'lost' | null;
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
  lifecycle_stage: LifecycleStage | null;   // null until the conductor has evaluated the lead
  lifecycle_actor: LifecycleActor | null;
  lifecycle_step: string | null;            // one sentence: what is happening or what is needed
  lifecycle_blocker: string | null;         // why it cannot move on its own (LIFECYCLE_BLOCKERS)
  lifecycle_next_at: string | null;         // when something is expected to change
  lifecycle_paused: boolean;                // a person said hands off
  sender_name?: string | null;              // whose LinkedIn sends for this lead (the prospect's owner)
  sender_user_id?: string | null;
}

/** Stages where the person who must act is the one whose LinkedIn sends (they approve the card), not the back office. */
const CARD_STAGES = new Set(['request_filed', 'first_message_waiting', 'followup_waiting']);

/** Who has to act on a lead the Lead Conductor marks "a person must act": the sender for an approval card, otherwise
 *  the back office (then the front office). `label` is "You" for the viewer, else the first name. */
export function whoActs(l: Pick<Lead, 'lifecycle_stage' | 'responsible_user_id' | 'responsible_name' | 'front_user_id' | 'front_name' | 'sender_user_id' | 'sender_name'>,
                        viewerId: string | null): { id: string | null; label: string } {
  const card = l.lifecycle_stage && CARD_STAGES.has(l.lifecycle_stage);
  const id = (card ? l.sender_user_id : null) || l.responsible_user_id || l.front_user_id || null;
  const name = (card ? l.sender_name : null) || l.responsible_name || l.front_name || '';
  if (id && viewerId && id === viewerId) return { id, label: 'You' };
  return { id, label: (name || 'Someone').split(' ')[0] };
}

/** "event:fakuma-2026" → "Fakuma 2026". The list a lead came from, as people say it. */
export function listLabel(source: string | null | undefined): string {
  const s = (source || '').replace(/^(event|linkedin|manual|form|calendly):/, '');
  if (!s) return 'No list';
  return s.split(/[-_]/).map((w) => (/^\d+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
    .replace(/^Pei /, 'PEI ').replace(/^Nrw /, 'NRW ');
}

export interface LeadCounts {
  working: number; due: number; must: number; needs_you: number; needs_anyone?: number;
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

/**
 * LinkedIn connection state + the suggested next step — a port of the kernel's
 * policy/next_step.py (and policy/invitations.lead_state). The list is read with
 * direct SQL, so both are derived here; if the kernel rule changes, change this with it.
 *
 * Amir (2026-10-16): no "in" to the contact → connect on LinkedIn first; connected → reach out.
 * An "in" = a LinkedIn connection, a warm introduction, or a channel we already hold (email / phone).
 */
/** A teammate's LinkedIn account that is linked to this lead (connection or request). */
export interface LinkedInLink {
  owner_user_id: string; owner: string | null; account: string | null;
  status: 'connected' | 'pending'; since: string | null;
}

export type LinkedInState =
  | 'connected' | 'awaiting_approval' | 'pending' | 'no_answer' | 'not_accepted' | 'failed' | 'not_invited' | 'no_profile';

export const NEXT_STEPS = {
  answer: 'Answer their reply',
  call_prep: 'Prepare for the call or meeting',
  first_message: 'Reach out: first message',
  follow_up: 'Follow up',
  approve_request: 'Approve the connection request',
  wait_accept: 'Wait for the connection request to be accepted',
  intro: 'Reach out through the introduction',
  email: 'Reach out by email',
  other_channel: 'Reach out on the channel we have',
  ask_intro: 'Ask for a warm introduction',
  connect: 'Connect on LinkedIn',
  find_profile: 'Find their LinkedIn profile',
} as const;
export type NextStepCode = keyof typeof NEXT_STEPS;
/** What the picker offers besides free text — the same words the suggestion and the kernel write. */
export const NEXT_STEP_PRESETS: string[] = [
  NEXT_STEPS.connect, NEXT_STEPS.first_message, NEXT_STEPS.follow_up, NEXT_STEPS.email,
  NEXT_STEPS.ask_intro, 'Book the call', NEXT_STEPS.call_prep, 'Send the deck',
];

type LinkedInFields = Pick<Lead, 'linkedin_url' | 'li_public_id' | 'li_degree' | 'li_invite_status' | 'li_invite_sent_at'
  | 'connect_waiting' | 'journey_stage'>;

export function linkedInState(l: LinkedInFields, noAnswerDays = 21, now = Date.now()): LinkedInState {
  if ((l.journey_stage ?? 0) >= 2) return 'connected';                         // hand-set on the journey bar
  if (l.li_degree === '1' || l.li_invite_status === 'accepted') return 'connected';
  if (l.li_invite_status === 'pending') {
    const days = l.li_invite_sent_at ? (now - new Date(l.li_invite_sent_at).getTime()) / 86_400_000 : 0;
    return days >= noAnswerDays ? 'no_answer' : 'pending';
  }
  const closed = l.li_invite_status === 'not_accepted' || l.li_invite_status === 'failed';
  if (l.connect_waiting) return 'awaiting_approval';
  if (closed) return l.li_invite_status as LinkedInState;
  return l.li_public_id || l.linkedin_url ? 'not_invited' : 'no_profile';
}

export function linkedInLabel(state: LinkedInState, l: Pick<Lead, 'li_invite_sent_at' | 'li_accepted_at' | 'journey_stage'>): { label: string; tone: 'good' | 'wait' | 'bad' | 'none' } {
  const d = (v: string | null) => (v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
  switch (state) {
    case 'connected': return { label: l.li_accepted_at ? `Connected · accepted ${d(l.li_accepted_at)}` : 'Connected', tone: 'good' };
    case 'awaiting_approval': return { label: 'Request filed · waits for approval', tone: 'wait' };
    case 'pending': return { label: l.li_invite_sent_at ? `Request pending · sent ${d(l.li_invite_sent_at)}` : 'Request pending', tone: 'wait' };
    case 'no_answer': return { label: `No answer · request sent ${d(l.li_invite_sent_at)}`, tone: 'bad' };
    case 'not_accepted': return { label: 'Request not accepted', tone: 'bad' };
    case 'failed': return { label: 'Request failed', tone: 'bad' };
    case 'not_invited': return { label: 'Not connected', tone: 'none' };
    default: return { label: 'No LinkedIn profile on file', tone: 'none' };
  }
}

export function suggestNextStep(l: Pick<Lead, 'status' | 'journey_outcome' | 'journey_stage' | 'email' | 'sent_count'
  | 'last_sent_at' | 'last_reply_at' | 'booking_status'> & LinkedInFields): { code: NextStepCode; label: string; why: string } | null {
  if (l.status === 'converted' || l.status === 'archived' || l.journey_outcome) return null;
  const stage = l.journey_stage ?? 0;
  const state = linkedInState(l);
  const pick = (code: NextStepCode, why: string) => ({ code, label: NEXT_STEPS[code], why });
  if (l.last_reply_at && (!l.last_sent_at || new Date(l.last_reply_at) > new Date(l.last_sent_at))) return pick('answer', 'they replied and we have not answered yet');
  if (l.booking_status === 'scheduled' || stage >= 4) return pick('call_prep', 'a call or meeting is set');
  if (state === 'connected') return l.sent_count === 0 ? pick('first_message', 'connected on LinkedIn, nothing sent yet') : pick('follow_up', 'connected and we have written — keep it moving');
  if (state === 'awaiting_approval') return pick('approve_request', "a connection request is filed and waits for the owner's approval");
  if (state === 'pending') return pick('wait_accept', 'the connection request is out');
  if (stage === 1) return pick('intro', 'someone introduced us');
  if ((l.email || '').trim()) return pick('email', 'we have their email and no LinkedIn connection');
  if (stage === 3) return pick('other_channel', 'another channel is already open');
  if (state === 'no_answer' || state === 'not_accepted' || state === 'failed') return pick('ask_intro', 'the connection request did not land and there is no other way in');
  if (state === 'not_invited') return pick('connect', 'no way in yet — connect first');
  return pick('find_profile', 'no LinkedIn profile on file, so nothing to connect to');
}
