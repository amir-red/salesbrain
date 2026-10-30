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
  lists: CampaignList[];
  settings: { daily_max_per_step?: number; samples?: Record<string, SavedSample>; auto_send?: AutoSend; allow_unverified?: boolean;
    send_from?: Choice; approve_by?: Choice };
  launched_at: string | null;
  paused_at: string | null; updated_at: string;
}

/** Trusted auto-send (084): after `trust_after` cards of a step approved unchanged, the step sends without a tap. */
export interface AutoSend { enabled: boolean; trust_after: number }
export interface StepTrust { node_id: string; sender_user_id: string; sender_name: string | null; enabled: boolean;
  trusted: boolean; human_approvals: number; needed: number; reset_at: string | null }

/** A/B (084): a message step may carry 2–3 variants; each inherits what it does not set from the step itself. */
export interface Variant { id: 'a' | 'b' | 'c'; label?: string; mode?: string; note_mode?: string; text?: string; subject?: string; instructions?: string }
export const VARIANT_IDS = ['a', 'b', 'c'] as const;
export function variantsOf(c: Record<string, unknown> | undefined): Variant[] {
  return Array.isArray(c?.variants) ? (c!.variants as Variant[]).filter((v) => v && typeof v === 'object' && v.id) : [];
}
/** The effective config of one variant: the step's keys, with the variant's own on top. */
export function variantConfig(c: Record<string, unknown>, id: string | null): Record<string, unknown> {
  const v = variantsOf(c).find((x) => x.id === id);
  if (!v) return c;
  const out: Record<string, unknown> = { ...c };
  for (const k of ['mode', 'note_mode', 'text', 'subject', 'instructions'] as const) if (v[k] != null && v[k] !== '') out[k] = v[k];
  return out;
}
export function sampleKey(nodeId: string, variantId: string | null): string { return variantId ? `${nodeId}:${variantId}` : nodeId; }

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
      return `up to ${plural(Number(c.timeout_days || 7), 'day')}`;
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
      return ({ back_office: 'back office', front_office: 'front office', sender: 'the sender' } as Record<string, string>)[String(c.to || 'back_office')] ?? '';
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

// ---------------------------------------------------------------- the wizard (/campaigns/new)
// The answers go to the kernel as `spec`; policy/campaigns.py::graph_from_spec draws the sequence from them. The
// functions below only DESCRIBE that plan for the right-hand column — the graph itself is built once, in Python.

export type Channel = 'email' | 'linkedin' | 'linkedin_then_email';
export type WriteMode = 'auto' | 'guided' | 'fixed';
export interface MessageSpec { mode: WriteMode; instructions: string; text: string; subject?: string }
export interface WizardSpec {
  channel: Channel; messages: number; reply_days: number[]; accept_days: number;
  connect_note: 'none' | WriteMode; connect_text: string; connect_instructions: string;
  first: MessageSpec; followups: MessageSpec; reply_to: 'back_office' | 'front_office' | 'sender'; reply_note: string;
}

export const DEFAULT_SPEC: WizardSpec = {
  channel: 'linkedin_then_email', messages: 3, reply_days: [5, 7, 7, 7], accept_days: 21,
  connect_note: 'none', connect_text: '', connect_instructions: '',
  first: { mode: 'auto', instructions: '', text: '', subject: '' },
  followups: { mode: 'guided', text: '', instructions: 'Shorter than the last message; one new useful thing; one easy question.' },
  reply_to: 'back_office', reply_note: 'They replied — take over the conversation.',
};

export const CHANNEL_OPTIONS: { key: Channel; label: string; hint: string; needs: ('email' | 'linkedin')[] }[] = [
  { key: 'email', label: 'Email only', hint: 'From the sender’s Gmail. Follow-ups reply in the same thread.', needs: ['email'] },
  { key: 'linkedin', label: 'LinkedIn only', hint: 'A connection request, then messages once they accept.', needs: ['linkedin'] },
  { key: 'linkedin_then_email', label: 'LinkedIn first, then email',
    hint: 'Connect on LinkedIn; anyone who does not accept gets the emails instead, if we have their address.',
    needs: ['linkedin', 'email'] },
];

const WRITTEN: Record<WriteMode, string> = { auto: 'written for you', guided: 'from your instructions', fixed: 'your exact text' };

export interface PlanLine { kind: 'send' | 'wait' | 'branch' | 'end'; text: string; detail?: string; indent?: boolean }

/** The sequence the wizard will draw, as lines a person reads top to bottom. */
export function describeSpec(s: WizardSpec): PlanLine[] {
  const out: PlanLine[] = [];
  const chain = (channel: 'email' | 'linkedin', indent = false) => {
    for (let i = 0; i < s.messages; i++) {
      const part = i === 0 ? s.first : s.followups;
      const name = i === 0 ? (channel === 'email' ? 'First email' : 'First LinkedIn message') : `Follow-up ${i}`;
      out.push({ kind: 'send', text: name, detail: WRITTEN[part.mode], indent });
      out.push({ kind: 'wait', text: `Wait ${s.reply_days[i] ?? 7} days for a reply`, indent });
    }
    out.push({ kind: 'end', text: 'Still no reply: the sequence ends', indent });
  };
  if (s.channel === 'email') {
    chain('email');
  } else {
    out.push({ kind: 'send', text: 'LinkedIn connection request',
      detail: s.connect_note === 'none' ? 'no note' : `note ${WRITTEN[s.connect_note as WriteMode]}` });
    out.push({ kind: 'wait', text: `Wait up to ${s.accept_days} days for them to accept` });
    chain('linkedin');
    out.push({ kind: 'branch', text: s.channel === 'linkedin_then_email'
      ? 'Not accepted, and we have their email:' : 'Not accepted: the sequence ends' });
    if (s.channel === 'linkedin_then_email') chain('email', true);
  }
  return out;
}

/** What still has to be filled before the wizard can draw a sequence that runs. */
export function specProblems(s: WizardSpec): string[] {
  const p: string[] = [];
  const check = (part: MessageSpec, label: string, needsSubject: boolean) => {
    if (part.mode === 'fixed' && !part.text.trim()) p.push(`Write the text for ${label}.`);
    if (part.mode === 'guided' && !part.instructions.trim()) p.push(`Write the instructions for ${label}.`);
    if (needsSubject && part.mode === 'fixed' && !(part.subject ?? '').trim()) p.push('Give the first email a subject.');
  };
  check(s.first, 'the first message', s.channel !== 'linkedin');
  if (s.messages > 1) check(s.followups, 'the follow-ups', false);
  if (s.channel !== 'email') {
    if (s.connect_note === 'fixed' && !s.connect_text.trim()) p.push('Write the connection note, or choose no note.');
    if (s.connect_note === 'fixed' && s.connect_text.length > 300) p.push('The connection note is over 300 characters.');
    if (s.connect_note === 'guided' && !s.connect_instructions.trim()) p.push('Write the instructions for the connection note.');
  }
  return p;
}


// ---------------------------------------------------------------- Test run drafts

export interface PreviewDraft { text: string | null; subject: string | null; why: string; mode: string; type: NodeType }
export interface PreviewPerson { full_name: string | null; company: string | null; title: string | null }
export interface Sample { text: string; subject: string | null; person: PreviewPerson | null }

function esc(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** A draft written for one person, turned back into a text for everyone: their name, company and title become
 *  {full_name} / {first_name} / {company} / {title}, so "Use as this step's text" works for the whole list. */
export function toTemplate(text: string, p: PreviewPerson | null): string {
  if (!p) return text;
  let out = text;
  const swap = (value: string | null | undefined, ph: string) => {
    const v = (value || '').trim();
    if (v.length >= 2) out = out.replace(new RegExp(`(?<![\\w{])${esc(v)}(?![\\w}])`, 'g'), ph);
  };
  swap(p.full_name, '{full_name}');
  swap(p.company, '{company}');
  swap(p.title, '{title}');
  swap((p.full_name || '').split(/\s+/)[0], '{first_name}');
  return out;
}

/** What a message step says on the canvas: its own text when written by you, else the latest sample draft.
 *  With variants, the first variant (or the winner) speaks for the card. */
export function messageOf(n: Pick<GraphNode, 'type' | 'config'>, sample?: Sample, variantId?: string | null): { text: string; sample: boolean } | null {
  const base = n.config || {};
  const vs = variantsOf(base);
  const vid = variantId ?? (vs.length ? (typeof base.winner === 'string' && vs.some((v) => v.id === base.winner) ? base.winner as string : vs[0].id) : null);
  const c = vid ? variantConfig(base, vid) : base;
  const mode = String(n.type === 'linkedin_connect' ? c.note_mode || 'none' : c.mode || 'auto');
  if (mode === 'fixed' && typeof c.text === 'string' && c.text.trim()) return { text: c.text, sample: false };
  // A sample was written for one person; the canvas speaks for everyone, so show it with the fillable fields.
  if (sample?.text) return { text: toTemplate(sample.text, sample.person), sample: true };
  return null;
}

/** Split a message into plain text and {placeholder} parts, so the fillable fields can be shown as such. */
export function fillableParts(text: string): { text: string; field?: string; known?: boolean }[] {
  const out: { text: string; field?: string; known?: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], field: m[1], known: PLACEHOLDERS.includes(m[1]) });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

// ---------------------------------------------------------------- saved samples (settings.samples)

/** A sample kept on the campaign: the words written for one person, and the step settings they were written for. */
export interface SavedSample extends Sample { cfg?: Record<string, unknown>; at?: string }

const SAMPLE_KEYS = ['mode', 'note_mode', 'instructions', 'text', 'subject'] as const;

/** A message step whose words are written per person (so a sample shows what that looks like). */
export function needsSample(n: Pick<GraphNode, 'type' | 'config'>, variantId?: string | null): boolean {
  const c = variantId ? variantConfig(n.config || {}, variantId) : (n.config || {});
  if (n.type === 'linkedin_connect') return ['auto', 'guided'].includes(String(c.note_mode || 'none'));
  return (n.type === 'linkedin_message' || n.type === 'email') && ['auto', 'guided'].includes(String(c.mode || 'auto'));
}

/** Every (step, variant) a sample can be written for: [node id, variant id | null, sample key]. */
export function sampleSlots(n: Pick<GraphNode, 'id' | 'type' | 'config'>): { variant: string | null; key: string }[] {
  const vs = variantsOf(n.config || {});
  return (vs.length ? vs.map((v) => v.id as string) : [null]).map((v) => ({ variant: v, key: sampleKey(n.id, v) }));
}

/** True when the step was changed (how it is written, its instructions) after its sample was written. */
export function sampleIsStale(n: Pick<GraphNode, 'config'>, s?: SavedSample, variantId?: string | null): boolean {
  if (!s?.cfg) return false;
  const c = variantId ? variantConfig(n.config || {}, variantId) : (n.config || {});
  return SAMPLE_KEYS.some((k) => (c[k] ?? null) !== (s.cfg?.[k] ?? null) && !(c[k] == null && s.cfg?.[k] == null));
}

/** The first words of a message, for the card: one or two short lines. */
export function summaryOf(text: string, max = 110): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max).replace(/\s\S*$/, '')}…` : t;
}

// ---------------------------------------------------------------- who sends, who approves (settings.send_from / approve_by)
// Mirrors policy/campaigns.py SEND_FROM / APPROVE_BY — change both.

export interface Choice { mode: string; user_id?: string }

export const SEND_FROM: { mode: string; label: string; hint: string }[] = [
  { mode: 'owner', label: 'Each person’s owner', hint: 'The teammate who holds the person (today’s rule).' },
  { mode: 'list_sender', label: 'The list’s “Sends from” seat', hint: 'Set on each list page; people on lists without one stay with their owner.' },
  { mode: 'back_office', label: 'The lead’s back office', hint: 'Only for people with a lead card; others stay with their owner.' },
  { mode: 'front_office', label: 'The lead’s front office', hint: 'Only for people with a lead card; others stay with their owner.' },
  { mode: 'person', label: 'One teammate', hint: 'Everyone in the campaign goes out from this teammate’s account.' },
];

export const APPROVE_BY: { mode: string; label: string; hint: string }[] = [
  { mode: 'sender', label: 'The sender', hint: 'Each card goes to the person whose account sends it.' },
  { mode: 'campaign_owner', label: 'The campaign owner', hint: 'Every card goes to whoever owns this campaign.' },
  { mode: 'person', label: 'One teammate', hint: 'Every card goes to this teammate.' },
];
