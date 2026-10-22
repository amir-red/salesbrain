/**
 * Campaigns (core 081) — the vocabulary the canvas shares with the kernel. Client-safe (no DB, no IO).
 *
 * The kernel's policy/campaigns.py is the source of truth for validation and walking; this file only mirrors the
 * names the UI needs to draw and edit a sequence. Change both together (NODE_TYPES, HANDLES, LABELS, EVENTS, the
 * branch fields and ops, the placeholders).
 */

export type NodeType =
  | 'start' | 'linkedin_connect' | 'linkedin_message' | 'email' | 'wait' | 'wait_for' | 'branch' | 'handoff' | 'end';
export type Handle = 'next' | 'yes' | 'timeout' | 'no';

export interface GraphNode { id: string; type: NodeType; config: Record<string, unknown>; position: { x: number; y: number } }
export interface GraphEdge { id: string; source: string; sourceHandle: Handle; target: string }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }
export interface Problem { node: string | null; message: string }
export interface Validation { ok: boolean; blockers: Problem[]; warnings: Problem[] }

export type CampaignStatus = 'draft' | 'live' | 'paused' | 'done' | 'archived';
export interface CampaignList { icp_id: string | null; source: string | null; include: boolean; name: string }

export interface Campaign {
  id: string; name: string; status: CampaignStatus; goal: string | null; writing_context: string | null;
  language: string | null; product_id: string | null; owner_user_id: string | null; graph: Graph;
  draft_graph: Graph | null; editing_graph: Graph; graph_version: number; validation: Validation; can_edit: boolean;
  lists: CampaignList[]; settings: { daily_max_per_step?: number }; launched_at: string | null;
  paused_at: string | null; updated_at: string;
}

export interface CampaignRow {
  id: string; name: string; status: CampaignStatus; goal: string | null; owner_name: string | null;
  product_name: string | null; has_unpublished: boolean; enrolled: number; active: number; handed_off: number;
  completed: number; sent: number; cards_waiting: number; lists: CampaignList[] | null; updated_at: string;
  launched_at: string | null;
}

export const NODE_TYPES: NodeType[] = [
  'start', 'linkedin_connect', 'linkedin_message', 'email', 'wait', 'wait_for', 'branch', 'handoff', 'end'];
export const ACTIONS: NodeType[] = ['linkedin_connect', 'linkedin_message', 'email'];

export const HANDLES: Record<NodeType, Handle[]> = {
  start: ['next'], linkedin_connect: ['next'], linkedin_message: ['next'], email: ['next'], wait: ['next'],
  wait_for: ['yes', 'timeout'], branch: ['yes', 'no'], handoff: [], end: [],
};

export const LABELS: Record<NodeType, string> = {
  start: 'Start', linkedin_connect: 'LinkedIn connection request', linkedin_message: 'LinkedIn message',
  email: 'Email', wait: 'Wait', wait_for: 'Wait for', branch: 'If', handoff: 'Hand to a person', end: 'End',
};

/** What each exit is called on the canvas, per step type. */
export const HANDLE_LABELS: Record<Handle, string> = { next: 'then', yes: 'yes', timeout: 'no / timed out', no: 'no' };

export const PALETTE: { type: NodeType; hint: string }[] = [
  { type: 'linkedin_connect', hint: 'Send a connection request, with or without a note' },
  { type: 'linkedin_message', hint: 'A message on LinkedIn (first message, or a follow-up in the conversation)' },
  { type: 'email', hint: 'An email from the sender’s Gmail; later emails follow up in the same thread' },
  { type: 'wait', hint: 'Wait a fixed time' },
  { type: 'wait_for', hint: 'Wait until they accept or reply — or give up after N days' },
  { type: 'branch', hint: 'Go one way or the other on what we know about them' },
  { type: 'handoff', hint: 'Stop automation and tell a person to take over' },
  { type: 'end', hint: 'Stop here' },
];

export const EVENTS: Record<string, string> = {
  accepted: 'the connection request is accepted',
  replied: 'they reply (LinkedIn or email)',
  linkedin_replied: 'they reply on LinkedIn',
  email_replied: 'they reply by email',
};

/** The kernel's WAIT_LABELS (policy/campaigns.py). */
export const WAIT_LABELS: Record<string, string> = {
  accepted: 'Wait for the acceptance', replied: 'Wait for a reply',
  linkedin_replied: 'Wait for a LinkedIn reply', email_replied: 'Wait for an email reply',
};

export const MODES: { key: string; label: string; hint: string }[] = [
  { key: 'auto', label: 'Write it for me', hint: 'Drafted from what we know, in the sender’s voice' },
  { key: 'guided', label: 'Follow my instructions', hint: 'Drafted in the sender’s voice, following what you write here' },
  { key: 'fixed', label: 'Use my exact text', hint: 'Your text with {first_name} {full_name} {company} {title} filled in' },
];
export const NOTE_MODES: { key: string; label: string; hint: string }[] = [
  { key: 'none', label: 'No note', hint: 'A plain request — usually accepted most often' },
  ...MODES,
];

export const HANDOFF_TO: { key: string; label: string }[] = [
  { key: 'back_office', label: 'Back office (drives the lead)' },
  { key: 'front_office', label: 'Front office (the face in calls)' },
  { key: 'sender', label: 'Whoever sent the messages' },
];

export const END_REASONS: { key: string; label: string }[] = [
  { key: 'completed', label: 'Completed' }, { key: 'no_response', label: 'No response' },
  { key: 'not_accepted', label: 'Not accepted' }, { key: 'not_a_fit', label: 'Not a fit' },
];

export const BRANCH_FIELDS: Record<string, { label: string; kind: 'bool' | 'number' | 'text' }> = {
  has_email: { label: 'has a usable email', kind: 'bool' },
  has_linkedin: { label: 'has a LinkedIn profile', kind: 'bool' },
  connected: { label: 'is connected on LinkedIn', kind: 'bool' },
  replied: { label: 'has replied', kind: 'bool' },
  fit_score: { label: 'fit score', kind: 'number' },
  company_size: { label: 'company size', kind: 'number' },
  language: { label: 'language', kind: 'text' },
  title: { label: 'title', kind: 'text' },
  company: { label: 'company', kind: 'text' },
  location: { label: 'location', kind: 'text' },
  list: { label: 'list', kind: 'text' },
};
export const BRANCH_OPS: Record<'bool' | 'number' | 'text', { key: string; label: string }[]> = {
  bool: [{ key: 'is_true', label: 'yes' }, { key: 'is_false', label: 'no' }],
  number: [{ key: 'gte', label: 'at least' }, { key: 'lte', label: 'at most' }, { key: 'equals', label: 'equals' }],
  text: [{ key: 'contains', label: 'contains' }, { key: 'not_contains', label: 'does not contain' }, { key: 'equals', label: 'is' }],
};

export const PLACEHOLDERS = ['first_name', 'full_name', 'company', 'title'];

export const STATUS_STYLE: Record<CampaignStatus, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'var(--text-muted)' },
  live: { label: 'Live', color: 'var(--green)' },
  paused: { label: 'Paused', color: 'var(--orange)' },
  done: { label: 'Done', color: 'var(--blue)' },
  archived: { label: 'Archived', color: 'var(--text-muted)' },
};

export const ENROLLMENT_STYLE: Record<string, { label: string; color: string }> = {
  active: { label: 'in progress', color: 'var(--green)' },
  paused: { label: 'paused', color: 'var(--orange)' },
  handed_off: { label: 'handed to a person', color: 'var(--blue)' },
  completed: { label: 'finished', color: 'var(--text-muted)' },
  stopped: { label: 'stopped', color: 'var(--text-muted)' },
};

function plural(n: number, w: string) { return `${n} ${w}${n === 1 ? '' : 's'}`; }

export function humanizeWait(cfg: Record<string, unknown>): string {
  const d = Number(cfg.days || 0), h = Number(cfg.hours || 0);
  const parts = [d ? plural(d, 'day') : '', h ? plural(h, 'hour') : ''].filter(Boolean);
  return parts.join(' ') || '0 hours';
}

/** The title a step shows — the same rule as the kernel's n_label. */
export function nodeLabel(n: Pick<GraphNode, 'type' | 'config'>): string {
  const cfg = n.config || {};
  if (typeof cfg.title === 'string' && cfg.title.trim()) return cfg.title.slice(0, 60);
  if (n.type === 'wait') return `Wait ${humanizeWait(cfg)}`;
  if (n.type === 'wait_for') return WAIT_LABELS[String(cfg.event)] ?? 'Wait for …';
  return LABELS[n.type] ?? n.type;
}

/** One line under the title: what the step will do. */
export function nodeSummary(n: Pick<GraphNode, 'type' | 'config'>): string {
  const c = n.config || {};
  switch (n.type) {
    case 'linkedin_connect': {
      const m = String(c.note_mode || 'none');
      return m === 'none' ? 'No note' : NOTE_MODES.find((x) => x.key === m)?.label ?? m;
    }
    case 'linkedin_message':
    case 'email':
      return MODES.find((x) => x.key === String(c.mode || 'auto'))?.label ?? String(c.mode);
    case 'wait_for':
      return `gives up after ${plural(Number(c.timeout_days || 7), 'day')}`;
    case 'branch': {
      const rules = (c.rules as { field: string; op: string; value?: unknown }[] | undefined) ?? [];
      if (!rules.length) return 'no rule yet';
      const r = rules[0];
      const f = BRANCH_FIELDS[r.field];
      const op = f ? BRANCH_OPS[f.kind].find((o) => o.key === r.op)?.label : r.op;
      const more = rules.length > 1 ? ` ${c.match === 'any' ? 'or' : 'and'} ${rules.length - 1} more` : '';
      return `${f?.label ?? r.field} ${op ?? ''}${f && f.kind !== 'bool' ? ` ${r.value ?? ''}` : ''}${more}`;
    }
    case 'handoff':
      return HANDOFF_TO.find((x) => x.key === String(c.to || 'back_office'))?.label.split(' (')[0] ?? '';
    case 'end':
      return END_REASONS.find((x) => x.key === String(c.reason || 'completed'))?.label ?? String(c.reason);
    default:
      return '';
  }
}

export function defaultConfig(t: NodeType): Record<string, unknown> {
  switch (t) {
    case 'linkedin_connect': return { note_mode: 'none' };
    case 'linkedin_message': return { mode: 'auto' };
    case 'email': return { mode: 'auto' };
    case 'wait': return { days: 3 };
    case 'wait_for': return { event: 'replied', timeout_days: 7 };
    case 'branch': return { match: 'all', rules: [{ field: 'has_email', op: 'is_true' }] };
    case 'handoff': return { to: 'back_office' };
    case 'end': return { reason: 'completed' };
    default: return {};
  }
}

export const CHANNEL_ICON: Partial<Record<NodeType, string>> = {
  linkedin_connect: 'in', linkedin_message: 'in', email: '@',
};
