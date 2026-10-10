/**
 * LinkedIn connection state of a lead — client-safe.
 *
 * A port of salesbrain-core policy/invitations.py::lead_state, the same way
 * lib/quota-server.ts ports the quota rules: the lead list is read with direct
 * SQL, so the one-word state is derived here. If the kernel rule changes,
 * change this with it.
 */
export type ConnectState =
  | 'connected' | 'awaiting_approval' | 'pending' | 'no_answer' | 'not_accepted' | 'failed' | 'not_invited'
  | 'awaiting_pick' | 'no_profile';

/** One candidate from a profile search by name (prospect_enrichment kind='linkedin', detail.candidates). */
export interface ProfileCandidate {
  name: string | null; headline: string | null; location: string | null;
  network_distance: string | null; public_identifier: string | null; provider_id: string | null;
  source?: 'web' | 'linkedin' | 'profile' | null;   // where the candidate came from
  rung?: string | null;                               // web | linkedin_name | linkedin_name_only | company_web
}
/** A decision maker found by starting from the company (company_web rung). */
export interface DiscoveredLeader {
  name: string | null; headline: string | null; public_identifier: string | null;
  landed: boolean; prospect_id?: string | null; icp_score?: number | null; note?: string | null;
}
/** The newest lookup-by-name attempt for a lead without a profile. */
export interface ProfileLookup {
  result: string;                 // found | ambiguous | no_match | duplicate | error | candidates
  reason: string | null;
  candidates: ProfileCandidate[];
  strong: string[];               // public identifiers the rule marked as strong
  duplicate_of: string | null;
  created_at: string;
  rung?: string | null;           // which rung wrote (found) — null when nothing did
  discovered?: DiscoveredLeader[];
  queries?: string[];
}

export interface ConnectFields {
  linkedin_public_id: string | null;
  network_degree: string | null;
  invite_status: string | null;
  invite_sent_at: string | null;
  invite_source?: string | null;
  invite_error?: string | null;
  connect_approval: string | null;
  profile_lookup?: ProfileLookup | null;
}

export const NO_ANSWER_AFTER_DAYS = 21;

export function connectState(l: ConnectFields, noAnswerDays = NO_ANSWER_AFTER_DAYS, now = Date.now()): ConnectState {
  if (l.network_degree === '1' || l.invite_status === 'accepted') return 'connected';
  if (l.invite_status === 'pending') {
    const days = l.invite_sent_at ? (now - new Date(l.invite_sent_at).getTime()) / 86_400_000 : 0;
    return days >= noAnswerDays ? 'no_answer' : 'pending';
  }
  // A request waiting for the owner's 👍 outranks an old closed one: it is what happens next.
  if (l.connect_approval) return 'awaiting_approval';
  if (l.invite_status === 'not_accepted' || l.invite_status === 'failed') return l.invite_status;
  if (l.linkedin_public_id) return 'not_invited';
  // A search by name that found candidates the rule would not pick alone: a person decides.
  const lk = l.profile_lookup;
  if (lk && (lk.result === 'ambiguous' || lk.result === 'candidates') && lk.candidates.length > 0) return 'awaiting_pick';
  return 'no_profile';
}

/** One line for the leads table / API notes from a lookup-by-name result. */
export const RUNG_LABEL: Record<string, string> = {
  web: 'web search', linkedin_name: 'LinkedIn search', linkedin_name_only: 'LinkedIn search by name',
  company_web: 'company search', user_pick: 'your pick',
};

export function describeLookup(r: { result?: string; linkedin_public_id?: string | null; reason?: string | null;
                                    duplicate_rank?: number | null; strong?: unknown[]; candidates?: unknown[];
                                    rung?: string | null; discovered?: { landed: boolean }[] } | null | undefined): string {
  if (!r || !r.result) return 'No lookup result.';
  const via = r.rung ? ` via ${RUNG_LABEL[r.rung] || r.rung}` : '';
  const landed = (r.discovered || []).filter((d) => d.landed).length;
  const extra = landed ? ` ${landed} decision maker${landed > 1 ? 's' : ''} at the company added as new leads.` : '';
  switch (r.result) {
    case 'found': return `Profile found${via}: ${r.linkedin_public_id}${r.reason ? ` (${r.reason})` : ''}.${extra}`;
    case 'already': return 'This lead already has a profile.';
    case 'ambiguous': return `${(r.strong || []).length} profiles match — pick the right one.`;
    case 'candidates': return `${(r.candidates || []).length} candidates — pick the right one.`;
    case 'duplicate': return `Same person as lead${r.duplicate_rank != null ? ` #${r.duplicate_rank}` : ' already on your list'}.`;
    case 'no_match': return `No matching profile${r.reason ? `: ${r.reason}` : ''}.${extra}`;
    default: return `Lookup ${r.result}${r.reason ? `: ${r.reason}` : ''}.`;
  }
}

export const CONNECT_LABEL: Record<ConnectState, string> = {
  connected: 'Connected',
  awaiting_approval: 'Awaiting approval',
  pending: 'Request sent',
  no_answer: 'No answer',
  not_accepted: 'Not accepted',
  failed: 'Failed',
  not_invited: 'Not invited',
  awaiting_pick: 'Pick profile',
  no_profile: 'No profile',
};

export const CONNECT_COLOR: Record<ConnectState, string> = {
  connected: 'var(--green)',
  awaiting_approval: 'var(--accent)',
  pending: 'var(--yellow)',
  no_answer: 'var(--orange)',
  not_accepted: 'var(--red)',
  failed: 'var(--red)',
  not_invited: 'var(--text-muted)',
  awaiting_pick: 'var(--yellow)',
  no_profile: 'var(--text-muted)',
};
