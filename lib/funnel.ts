/**
 * The funnel — one ladder for every person, from a name on a list to a client (plan: funnel-redesign.md, 2026-10-26).
 *
 * The kernel (salesbrain-core policy/funnel.py) decides each person's stage; this file only carries the words and the
 * shape of GET /api/funnel. FUNNEL_STAGES / FUNNEL_LABELS / FUNNEL_LANES must equal the kernel's STAGES / LABELS /
 * LANES — salesbrain-core/tests/test_funnel_parity.py fails when they drift. Client-safe (no server imports).
 *
 *   Prospect     on a list, nobody has contacted them yet (hand-picked lists too) — sourced → scored → ready to reach
 *   Lead         only once contact happens (request, message, email, intro ask; met in person or came to us = engaged)
 *                — contacted → engaged → meeting → qualified; quiet 30 days with nothing planned = resting
 *   Opportunity  a qualified lead converted to a deal
 *   Client       a won opportunity
 */

export const FUNNEL_STAGES = [
  'prospect_sourced', 'prospect_scored', 'prospect_ready',
  'lead_contacted', 'lead_engaged', 'lead_meeting', 'lead_qualified',
  'opportunity', 'client',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_LABELS = {
  prospect_sourced: 'Sourced', prospect_scored: 'Scored', prospect_ready: 'Ready to reach',
  lead_contacted: 'Contacted', lead_engaged: 'Engaged', lead_meeting: 'Meeting',
  lead_qualified: 'Qualified', opportunity: 'Opportunity', client: 'Client',
} as const;

export type FunnelGroup = 'prospect' | 'lead' | 'opportunity' | 'client';

export const FUNNEL_GROUPS: { key: FunnelGroup; label: string; meaning: string }[] = [
  { key: 'prospect', label: 'Prospects', meaning: 'On a list, nobody has contacted them yet. Agents find, score and research them.' },
  { key: 'lead', label: 'Leads', meaning: 'We are in contact: we reached out, met them, or they came to us. People work them.' },
  { key: 'opportunity', label: 'Opportunities', meaning: 'Qualified leads with a buyer, price and scope.' },
  { key: 'client', label: 'Clients', meaning: 'Won opportunities.' },
];

export const FUNNEL_LANES = {
  warm: 'Own network',
  event: 'Met at an event',
  inbound: 'Came to us',
  imported: 'Hand-picked list',
  sourced: 'Found by agents',
  direct: 'Opportunity created directly',
} as const;
export type FunnelLane = keyof typeof FUNNEL_LANES;

export type FunnelView = 'people' | 'companies';

export const FUNNEL_PERIODS = {
  today: 'Today', yesterday: 'Yesterday', week: 'This week', last_week: 'Last week', month: 'This month',
  '7d': 'Last 7 days', '30d': 'Last 30 days',
} as const;
export type FunnelPeriod = keyof typeof FUNNEL_PERIODS;

export const FUNNEL_EXITS = { unfit: 'Not a fit', lost: 'Lost', archived: 'Archived', nurture: 'Resting' } as const;

export const SUBSTAGE_LABELS: Record<string, string> = {
  request_pending: 'request pending',
  connected: 'connected, not messaged',
  messaged: 'messaged',
  request_declined: 'request not accepted',
  answered: 'answered',
  met_in_person: 'met in person',
  came_to_us: 'came to us',
};

export const CHANNEL_LABELS: Record<string, Record<string, string>> = {
  linkedin: { none: 'no profile', profile: 'profile found', pending: 'request pending', connected: 'connected', declined: 'not accepted' },
  email: { none: 'no email', known: 'email known', sent: 'emailed' },
};

export interface FunnelStageRow {
  key: FunnelStage;
  label: string;
  group: FunnelGroup;
  meaning: string;
  current: number;
  reached: number;
  direct: number;
  conversion: number | null;
  exits: Partial<Record<keyof typeof FUNNEL_EXITS, number>>;
  substages: Record<string, number>;
  /** With a period: people who ENTERED this stage in it (from the dated history, core 086). */
  entered?: number;
}

export interface FunnelSummary {
  stages: FunnelStageRow[];
  exits: Record<keyof typeof FUNNEL_EXITS, number>;
  lanes: { key: FunnelLane; label: string; total: number; leads: number }[];
  channels: { linkedin: Record<string, number>; email: Record<string, number> };
  people: number;
  direct_opportunities: number;
  slice: { icp: { id: string; name: string } | null; owner: { id: string; name: string } | null; lane: string | null; deal_type: string; view: FunnelView };
  period?: { key: FunnelPeriod; start: string; end: string };
  /** When the stored funnel was last recomputed (it refreshes itself every 10 minutes on read and every hour). */
  evaluated_at: string | null;
  definitions: { stages: Record<string, string>; exits: Record<string, string>; lanes: Record<string, string> };
}

/** Sum of a group's `current` (people there now). */
export function groupCount(s: FunnelSummary, g: FunnelGroup): number {
  return s.stages.filter((r) => r.group === g).reduce((n, r) => n + r.current, 0);
}

export function pct(v: number | null | undefined): string {
  if (v == null) return '—';
  const p = v * 100;
  return p >= 10 || p === 0 ? `${Math.round(p)}%` : `${p.toFixed(1)}%`;
}
