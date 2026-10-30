/**
 * The list page as a journey (design A "Next move", 2026-10-29): what the seller should do NEXT on this list, in
 * the order that moves people toward a client — answer a reply, message the people who accepted, send today's
 * requests, follow up with the quiet ones, pick the right profile. Client-safe contract between
 * `GET /api/icp/[id]/journey` and `components/icp/journey/*`. Pure types and helpers; no DB imports.
 */
import type { ListFunnel } from '@/lib/icp-panel';

export type LaneKey = 'answer' | 'message' | 'send' | 'follow' | 'pick';

/** One person in a lane, with the one thing that can be done for them from here. */
export interface LanePerson {
  prospect_id: string;
  full_name: string | null;
  company: string | null;
  title: string | null;
  icp_score: number | null;
  priority: number | null;
  /** What happened / why they are here, one short line ("accepted 4 d ago", "“Gern, Donnerstag passt.”"). */
  detail: string | null;
  /** The moment the line refers to (ISO), for relative times. */
  at: string | null;
  /** A draft already waiting for the owner's decision (approve = send through the gate). */
  approval_id: string | null;
  /** The conversation to answer (answer lane): LinkedIn thread or email thread + channel. */
  thread_id: string | null;
  channel: 'linkedin' | 'email' | null;
  /** answer lane: the lead's card, so "Answer" can open the Inbox / the card. */
  lead_id: string | null;
}

export interface JourneyEvent {
  kind: 'reply' | 'accepted' | 'sent' | 'request' | 'found' | 'run' | 'campaign';
  text: string;
  at: string;
  prospect_id?: string | null;
}

export interface JourneyCampaign {
  id: string; name: string; status: string; enrolled: number; active: number; handed_off: number;
  sent: number; cards_waiting: number; launched_at: string | null; owner_name: string | null;
  /** The newest pending card of the campaign (one tap approves its drafts), if any. */
  card_id: string | null;
}

export interface JourneyPayload {
  icp: { id: string; name: string; owner_user_id: string; owner_name: string; total: number; paused_at: string | null;
    /** 094: the daily LinkedIn connector for this list. */
    daily_connect: 'off' | 'card' | 'auto' };
  viewer: { user_id: string; is_admin: boolean; is_owner: boolean; can_edit: boolean };
  /** Whose LinkedIn sends for this list (the owner), and whether it is connected. */
  sender: { name: string; linkedin: boolean; sales_navigator: boolean;
    /** The sender's newest daily batch (any list of theirs), for the "In progress" line. */
    last_batch: { mode: 'card' | 'auto'; status: string; size: number; sent: number | null; failed: number | null; at: string } | null };
  lanes: Record<LaneKey, LanePerson[]>;
  /** Beyond the lanes' rows: how many more could be queued, found recently, etc. */
  counts: {
    /** Leads with a profile, not yet asked, not connected, no request waiting — what "Queue next N" draws from. */
    send_ready: number;
    /** Profiles found in the last 5 hours (fresh: the person is most likely to be on LinkedIn today). */
    fresh_profiles: number;
    /** Leads without any LinkedIn identifier the Enricher could still look up. */
    no_profile: number;
    requests_pending: number;
    followups_timed: number;
    messaged_waiting: number;
  };
  connect: {
    per_day: number; per_week: number; sent_today: number; sent_week: number; remaining: number;
    next_request_at: string | null; enabled: boolean;
  };
  events: JourneyEvent[];
  campaigns: JourneyCampaign[];
  funnel: ListFunnel | null;
  generated_at: string;
}

export const LANE_META: Record<LaneKey, { label: string; when: string; sub: string; color: string; verb: string }> = {
  answer:  { label: 'Answer',    when: 'now',       sub: 'people who replied and wait on you',            color: 'var(--lane-answer)',  verb: 'Answer' },
  message: { label: 'Message',   when: 'today',     sub: 'accepted your request, never messaged',          color: 'var(--lane-message)', verb: 'Message' },
  send:    { label: 'Send',      when: 'today',     sub: 'connection requests picked by priority and fit', color: 'var(--lane-send)',    verb: 'Send' },
  follow:  { label: 'Follow up', when: 'this week', sub: 'messaged, quiet for days',                      color: 'var(--lane-follow)',  verb: 'Follow up' },
  pick:    { label: 'Pick',      when: 'when free', sub: 'two profiles match — choose the right one',      color: 'var(--lane-pick)',    verb: 'Pick' },
};
export const LANE_ORDER: LaneKey[] = ['answer', 'message', 'send', 'follow', 'pick'];

export interface Hero { lane: LaneKey | null; title: string; why: string; button: string; next: string | null }

/**
 * The one move the page leads with: a reply beats everything (it is the only step the other side takes), then the
 * people who accepted, then today's requests, then follow-ups, then picks. `remaining` = the connect cap left today.
 */
export function heroFor(p: JourneyPayload): Hero {
  const n = (k: LaneKey) => p.lanes[k].length;
  const first = (k: LaneKey) => p.lanes[k][0];
  const nameOf = (x?: LanePerson) => x?.full_name?.split(' ')[0] ?? 'them';
  const after = (k: LaneKey): string | null => {
    const i = LANE_ORDER.indexOf(k);
    for (const key of LANE_ORDER.slice(i + 1)) if (n(key) > 0) return `then: ${LANE_META[key].verb.toLowerCase()} ${n(key)} ${n(key) === 1 ? 'person' : 'people'}`;
    if (k !== 'send' && p.counts.send_ready > 0 && p.connect.remaining > 0) return `then: queue ${Math.min(p.counts.send_ready, p.connect.remaining)} requests`;
    return null;
  };
  if (n('answer')) {
    const names = p.lanes.answer.slice(0, 3).map((x) => x.full_name?.split(' ').pop() ?? '?').join(', ');
    return { lane: 'answer', title: `${n('answer')} ${n('answer') === 1 ? 'person' : 'people'} answered and ${n('answer') === 1 ? 'waits' : 'wait'} on you`,
      why: `A reply is the only step the other side takes. ${names} wrote back — answer today, while it is warm.`, button: `Answer ${nameOf(first('answer'))}`, next: after('answer') };
  }
  if (n('message')) {
    return { lane: 'message', title: `Message the ${n('message')} ${n('message') === 1 ? 'person' : 'people'} who accepted`,
      why: 'They opened the door and heard nothing since. A connection that is messaged answers far more often than a bare request.', button: n('message') === 1 ? 'Write to them' : 'Review drafts', next: after('message') };
  }
  if (n('send')) {
    return { lane: 'send', title: `Send ${n('send')} connection ${n('send') === 1 ? 'request' : 'requests'} waiting for your tap`,
      why: 'Picked by priority, fit and warmth, one person per company. Each one goes out from your LinkedIn at a human pace.', button: `Send ${n('send')}`, next: after('send') };
  }
  if (p.counts.send_ready > 0 && p.connect.remaining > 0 && p.sender.linkedin) {
    const k = Math.min(p.counts.send_ready, p.connect.remaining);
    return { lane: 'send', title: `Queue today's ${k} connection ${k === 1 ? 'request' : 'requests'}`,
      why: `${p.counts.fresh_profiles ? `${p.counts.fresh_profiles} profiles were found in the last hours — people are most reachable the day their profile is found. ` : ''}${p.connect.remaining} of ${p.connect.per_day} requests are still free today.`,
      button: `Queue ${k}`, next: after('send') };
  }
  if (n('follow')) {
    return { lane: 'follow', title: `Follow up with ${n('follow')} ${n('follow') === 1 ? 'person' : 'people'} who went quiet`,
      why: 'Messaged, no answer. One short new reason to talk, in the same thread.', button: 'Review follow-ups', next: after('follow') };
  }
  if (n('pick')) {
    return { lane: 'pick', title: `Pick the right profile for ${n('pick')} ${n('pick') === 1 ? 'person' : 'people'}`,
      why: 'The search found more than one match. Until someone picks, the agents cannot connect or write.', button: 'Pick now', next: null };
  }
  if (!p.sender.linkedin) {
    return { lane: null, title: `${p.sender.name} has no LinkedIn connected`, why: 'Nothing can go out from this list until the owner connects LinkedIn on Profile → LinkedIn.', button: 'Open Profile', next: null };
  }
  return { lane: null, title: 'Nothing waits on you right now', why: p.connect.remaining === 0 && p.connect.next_request_at
      ? `Today's requests are all out. The next one is free ${new Date(p.connect.next_request_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
      : 'The agents keep finding profiles and the hourly sync watches for replies and acceptances. Come back after the next sync.', button: 'See all people', next: null };
}

/** Initials for an avatar. */
export function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}
