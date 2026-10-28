/**
 * The Deals page (board + list) and the deal page: one shape for a deal row and the rules that turn it into what a
 * person sees. Client-safe (no DB). The server side is `lib/deals-board.ts`.
 *
 * Rules (2026-10-24, the Deals / Pipeline merge):
 *   won         status 'won' (grants, closed by mark_grant_won) OR a sales deal at its final gate (G9). A won sales deal
 *               keeps status 'active' on purpose — pmi_sync and the attention digest read active deals — and records
 *               won_at (core 083).
 *   in delivery a CONFIRMED delivery_links row whose PMI status is 'in-pilot' (core domain/delivery.IN_DELIVERY);
 *               'paused' = delivery stalled. Either way the deal has left sales: no gate SLA.
 *   overdue     an open deal past its gate's SLA, not won, not in (or paused in) delivery, not a signed grant.
 *   vote open   a board_decisions row with status 'pending' — not merely "sits at a board gate".
 */
import { AI_CREDIT_GATES, GRANT_GATES, SALES_GATES, type Gate } from '@/lib/gates';

export type DealType = 'sales' | 'grant' | 'ai_credit';
export type DealStatus = 'active' | 'won' | 'lost' | 'cancelled';

export interface DealItem {
  id: string;
  name: string;
  company: string;
  deal_type: DealType;
  status: DealStatus;
  gate: number;
  score: number | null;
  priority: number | null;   // the one person priority (091), 1 = top
  value: number | null;
  currency: string;
  user_id: string;
  creator_name: string | null;
  lead_id: string | null;
  lead_name: string | null;
  rep_name: string | null;
  gate_entered_at: string;
  days_in_gate: number;
  created_at: string;
  updated_at: string;
  won_at: string | null;
  contract_signed_at: string | null;
  delivery_status: string | null;
  delivery_health: string | null;
  delivery_step: string | null;
  vote_gate: number | null;
  vote_proceed: number;
  vote_stop: number;
  vote_required: number | null;
}

export const DEAL_TYPES: { key: DealType; label: string; color: string }[] = [
  { key: 'sales', label: 'Sales', color: 'var(--accent)' },
  { key: 'grant', label: 'Grants', color: 'var(--green)' },
  { key: 'ai_credit', label: 'Credits', color: 'var(--yellow)' },
];

export function gatesFor(type: DealType): Gate[] {
  return type === 'grant' ? GRANT_GATES : type === 'ai_credit' ? AI_CREDIT_GATES : SALES_GATES;
}

// Column colours. Board gates deep plum, ordinary gates heather, the final gate green; credits' Awarded amber.
const BOARD = '#691C47';
const GATE = '#6C477D';
const DONE = '#166534';
export function gateColor(type: DealType, gate: number): string {
  if (type === 'ai_credit') return gate === 5 ? DONE : gate === 4 ? '#994708' : GATE;
  const gates = gatesFor(type);
  if (gate === gates[gates.length - 1].number) return DONE;
  return gates.find((g) => g.number === gate)?.isBoard ? BOARD : GATE;
}

export function gateName(d: Pick<DealItem, 'deal_type' | 'gate'>): string {
  return gatesFor(d.deal_type).find((g) => g.number === d.gate)?.name ?? '';
}

export const isWon = (d: Pick<DealItem, 'status' | 'deal_type' | 'gate'>) =>
  d.status === 'won' || (d.deal_type === 'sales' && d.status === 'active' && d.gate === SALES_GATES[SALES_GATES.length - 1].number);
export const isClosed = (d: Pick<DealItem, 'status'>) => d.status === 'lost' || d.status === 'cancelled';
export const inDelivery = (d: Pick<DealItem, 'delivery_status'>) => d.delivery_status === 'in-pilot';
export const deliveryStalled = (d: Pick<DealItem, 'delivery_status'>) => d.delivery_status === 'paused';
export const voteOpen = (d: Pick<DealItem, 'vote_gate'>) => d.vote_gate !== null && d.vote_gate !== undefined;

export function slaDays(d: Pick<DealItem, 'deal_type' | 'gate'>): number {
  return gatesFor(d.deal_type).find((g) => g.number === d.gate)?.slaDays ?? 0;
}

/** Does the gate SLA clock apply? Only to an open deal still in sales: not won, not in (or paused in) delivery,
 *  not a signed grant (those run on report / resource deadlines, see /grants). */
export function hasClock(d: DealItem): boolean {
  return d.status === 'active' && !isWon(d) && !inDelivery(d) && !deliveryStalled(d) && !d.contract_signed_at && slaDays(d) > 0;
}

export function isOverdue(d: DealItem): boolean {
  return hasClock(d) && d.days_in_gate > slaDays(d);
}

/** One label for the deal's state, the way a person would say it. */
export function stateLabel(d: DealItem): { label: string; color: string } {
  if (d.status === 'lost') return { label: 'Lost', color: 'var(--red)' };
  if (d.status === 'cancelled') return { label: 'Cancelled', color: 'var(--text-muted)' };
  if (inDelivery(d)) return { label: 'In delivery', color: 'var(--green)' };
  if (isWon(d)) return { label: 'Won', color: 'var(--green)' };
  if (voteOpen(d)) return { label: 'Board vote open', color: 'var(--cat-violet)' };
  if (isOverdue(d)) return { label: 'Overdue', color: 'var(--red)' };
  return { label: 'Open', color: 'var(--text-muted)' };
}

export const HEALTH_COLOR: Record<string, string> = { green: 'var(--green)', yellow: 'var(--yellow)', amber: 'var(--yellow)', red: 'var(--red)' };

export function initials(name: string | null | undefined): string {
  return (name || '').split(' ').filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

export function money(value: number | null, currency: string): string {
  if (!value) return '—';
  const v = Number(value);
  const s = v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 10_000 ? `${Math.round(v / 1_000)}K` : Math.round(v).toLocaleString();
  return `${currency || 'USD'} ${s}`;
}

export interface Summary {
  open: number;
  inPlay: Record<string, number>;
  weighted: Record<string, number>;
  won: number;
  wonValue: Record<string, number>;
  lost: number;
  votes: number;
  overdue: number;
  delivery: number;
}

export function summarize(deals: DealItem[]): Summary {
  const s: Summary = { open: 0, inPlay: {}, weighted: {}, won: 0, wonValue: {}, lost: 0, votes: 0, overdue: 0, delivery: 0 };
  const add = (m: Record<string, number>, c: string, v: number) => { m[c] = (m[c] || 0) + v; };
  for (const d of deals) {
    const cur = d.currency || 'USD';
    const v = d.value ? Number(d.value) : 0;
    if (d.status === 'lost') { s.lost++; continue; }
    if (d.status === 'cancelled') continue;
    if (inDelivery(d)) s.delivery++;
    if (isWon(d)) { s.won++; add(s.wonValue, cur, v); continue; }
    s.open++;
    add(s.inPlay, cur, v);
    if (d.score !== null && d.score !== undefined) add(s.weighted, cur, v * (Number(d.score) / 100));
    if (voteOpen(d)) s.votes++;
    if (isOverdue(d)) s.overdue++;
  }
  return s;
}

export function moneyByCurrency(by: Record<string, number>): string {
  const e = Object.entries(by).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return e.length ? e.map(([c, v]) => money(v, c)).join(' · ') : '—';
}

// ─── Filters (kept in the URL so a view can be shared) ─────────────────────────
export type View = 'list' | 'board';
export type Scope = 'mine' | 'everyone';
export type StatusFilter = 'current' | 'won' | 'lost' | 'cancelled' | 'all';
export type Flag = 'overdue' | 'vote' | 'delivery' | '';
/** Priority filter: '' any · 'top' P1–P3 · 'set' any set · 'none' unset · '1'..'10' one level. */
export type PriorityFilter = string;

export const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'current', label: 'Open & won' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

export const FLAGS: { key: Exclude<Flag, ''>; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'vote', label: 'Board vote open' },
  { key: 'delivery', label: 'In delivery' },
];

export function matches(d: DealItem, o: { userId: string; scope: Scope; status: StatusFilter; flag: Flag; q: string; type: DealType | 'all'; priority?: PriorityFilter }): boolean {
  if (o.type !== 'all' && d.deal_type !== o.type) return false;
  const pr = o.priority || '';
  if (pr === 'set' && d.priority == null) return false;
  if (pr === 'top' && !(d.priority != null && d.priority <= 3)) return false;
  if (pr === 'none' && d.priority != null) return false;
  if (/^(10|[1-9])$/.test(pr) && d.priority !== Number(pr)) return false;
  if (o.scope === 'mine' && d.user_id !== o.userId && d.lead_id !== o.userId) return false;
  if (o.status === 'current' && isClosed(d)) return false;
  if (o.status === 'won' && !isWon(d)) return false;
  if ((o.status === 'lost' || o.status === 'cancelled') && d.status !== o.status) return false;
  if (o.flag === 'overdue' && !isOverdue(d)) return false;
  if (o.flag === 'vote' && !voteOpen(d)) return false;
  if (o.flag === 'delivery' && !(inDelivery(d) || deliveryStalled(d))) return false;
  if (o.q) {
    const q = o.q.toLowerCase();
    if (![d.name, d.company, d.lead_name, d.rep_name, d.creator_name].some((v) => (v || '').toLowerCase().includes(q))) return false;
  }
  return true;
}
