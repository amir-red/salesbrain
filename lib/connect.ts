/**
 * LinkedIn connection state of a lead — client-safe.
 *
 * A port of salesbrain-core policy/invitations.py::lead_state, the same way
 * lib/quota-server.ts ports the quota rules: the lead list is read with direct
 * SQL, so the one-word state is derived here. If the kernel rule changes,
 * change this with it.
 */
export type ConnectState =
  | 'connected' | 'awaiting_approval' | 'pending' | 'no_answer' | 'not_accepted' | 'failed' | 'not_invited' | 'no_profile';

export interface ConnectFields {
  linkedin_public_id: string | null;
  network_degree: string | null;
  invite_status: string | null;
  invite_sent_at: string | null;
  invite_source?: string | null;
  invite_error?: string | null;
  connect_approval: string | null;
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
  return l.linkedin_public_id ? 'not_invited' : 'no_profile';
}

export const CONNECT_LABEL: Record<ConnectState, string> = {
  connected: 'Connected',
  awaiting_approval: 'Awaiting approval',
  pending: 'Request sent',
  no_answer: 'No answer',
  not_accepted: 'Not accepted',
  failed: 'Failed',
  not_invited: 'Not invited',
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
  no_profile: 'var(--text-muted)',
};
