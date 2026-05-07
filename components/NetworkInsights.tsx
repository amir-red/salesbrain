'use client';

import { useEffect, useRef, useState } from 'react';
import type { GraphNode } from '@/lib/network-graph';
import type { NetworkFilterState } from './NetworkFilters';
import { EMPTY_FILTERS } from './NetworkFilters';

export interface NetworkInsightsResult {
  high_value_contacts?: { contact_id: string; reason: string }[];
  warm_intro_paths?: { from_contact_id: string; to_company: string; reason: string }[];
  industry_clusters_with_potential?: { industry: string; contact_count: number; action: string }[];
  neglected_but_valuable?: { contact_id: string; last_contacted_days: number; reason: string }[];
  best_next_outreach?: { contact_id: string; suggested_message_hook: string }[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  nodes: GraphNode[];
  onFocusNode: (nodeId: string) => void;
  /** Apply structural filters from a Claude tool call. */
  onApplyFilters: (next: NetworkFilterState) => void;
  /** Highlight a small set of contact UUIDs (graph dims everything else). */
  onHighlightContacts: (contactIds: string[]) => void;
  /** Reset highlights/filters back to default. */
  onClearView: () => void;
  /** Companies metadata: graph stores company nodes by uuid, but Claude
   *  references them by *name* in tool calls. We need name → uuid lookup. */
  companies: { id: string; name: string }[];
}

// Structured payload attached to an assistant message after Claude calls a
// tool — drives the clickable result card below the prose bubble.
type FilterCriteria = {
  industries?: string[];
  companies?: string[];
  locations?: string[];
  title_contains?: string;
  has_email?: boolean;
  has_linkedin?: boolean;
  has_prospect?: boolean;
  has_deal?: boolean;
  last_contacted?: 'any' | 'never' | 'lt30' | 'gt30' | 'gt90';
};
type ToolResult =
  | { tool: 'highlight_contacts'; contact_ids: string[]; reason: string }
  | { tool: 'filter_graph'; criteria: FilterCriteria; explanation: string }
  | { tool: 'clear_view' };

type ChatMsg = {
  role: 'user' | 'assistant';
  content: string;
  toolResult?: ToolResult;
};

type Mode = 'insights' | 'chat';

export default function NetworkInsights(props: Props) {
  const [mode, setMode] = useState<Mode>('chat');
  if (!props.open) return null;

  return (
    <aside
      className="absolute top-0 right-0 h-full w-[440px] flex flex-col border-l overflow-hidden z-20"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
    >
      <header className="flex items-center justify-between p-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-1 rounded border" style={{ borderColor: 'var(--border)' }}>
          <TabBtn active={mode === 'chat'} onClick={() => setMode('chat')}>Chat</TabBtn>
          <TabBtn active={mode === 'insights'} onClick={() => setMode('insights')}>One-shot insights</TabBtn>
        </div>
        <button onClick={props.onClose} className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
      </header>

      {mode === 'chat'
        ? <ChatPanel {...props} />
        : <InsightsPanel {...props} />}
    </aside>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 text-xs"
      style={{
        background: active ? 'var(--accent-glow)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

// ─── Chat panel ─────────────────────────────────────────────────────────────

function ChatPanel({ nodes, companies, onApplyFilters, onHighlightContacts, onClearView, onFocusNode }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  // Richer lookup so result cards can show name + title + company without
  // re-walking `nodes` each render.
  const infoByContact = new Map<string, { name: string; title: string | null; company: string | null }>();
  for (const n of nodes) {
    if (n.type === 'contact') {
      const m = n.metadata as Record<string, unknown>;
      infoByContact.set(m.contact_id as string, {
        name: n.label,
        title: (m.title as string) ?? null,
        company: (m.company as string) ?? null,
      });
    }
  }
  // Backwards-compat helper for `describeToolCall` (still receives label-only map).
  const labelByContact = new Map(Array.from(infoByContact, ([id, v]) => [id, v.name]));
  const companyIdByName = new Map(companies.map((c) => [c.name.toLowerCase(), c.id]));

  async function send(userText: string) {
    const trimmed = userText.trim();
    if (!trimmed || busy) return;
    setError(null);

    const next = [...messages, { role: 'user' as const, content: trimmed }];
    setMessages(next);
    setInput('');
    setBusy(true);

    // Build the graph_summary the API expects (compact, capped).
    const summary = buildSummary(nodes, companies);

    try {
      const res = await fetch('/api/network/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, graph_summary: summary }),
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Request failed (${res.status})`);
      }

      // We append an empty assistant message and stream into it.
      let assistantBuf = '';
      setMessages((m) => [...m, { role: 'assistant', content: '' }]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let leftover = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        leftover += decoder.decode(value, { stream: true });
        const lines = leftover.split('\n');
        leftover = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'text') {
              assistantBuf += evt.text;
              setMessages((m) => {
                const copy = [...m];
                copy[copy.length - 1] = { role: 'assistant', content: assistantBuf };
                return copy;
              });
            } else if (evt.type === 'tool_call') {
              applyToolCall(evt.tool, evt.input);
              const note = describeToolCall(evt.tool, evt.input, labelByContact);
              if (note) {
                assistantBuf += (assistantBuf ? '\n\n' : '') + `→ ${note}`;
              }
              // Attach the structured tool payload so the bubble can render
              // a clickable result card below the prose.
              const toolResult = buildToolResult(evt.tool, evt.input);
              setMessages((m) => {
                const copy = [...m];
                const last = copy[copy.length - 1];
                copy[copy.length - 1] = {
                  role: 'assistant',
                  content: assistantBuf,
                  // Preserve any prior toolResult; if Claude fires multiple
                  // tools in one response the last one wins (rare).
                  toolResult: toolResult ?? last.toolResult,
                };
                return copy;
              });
            } else if (evt.type === 'error') {
              throw new Error(evt.error || 'Chat error');
            }
          } catch (parseErr) {
            // Tolerate a partial JSON line at the boundary.
            if (parseErr instanceof Error && parseErr.message.startsWith('Unexpected')) continue;
            throw parseErr;
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  function applyToolCall(tool: string, input: Record<string, unknown>) {
    if (tool === 'highlight_contacts') {
      const ids = Array.isArray(input.contact_ids) ? (input.contact_ids as string[]) : [];
      onHighlightContacts(ids.slice(0, 50));
    } else if (tool === 'filter_graph') {
      const next: NetworkFilterState = { ...EMPTY_FILTERS };
      if (Array.isArray(input.industries)) next.industries = input.industries as string[];
      // Claude returns company *names*; convert to UUIDs the filter expects.
      if (Array.isArray(input.companies)) {
        next.companies = (input.companies as string[])
          .map((n) => companyIdByName.get(n.toLowerCase()))
          .filter((x): x is string => !!x);
      }
      if (Array.isArray(input.locations)) next.locations = input.locations as string[];
      if (typeof input.title_contains === 'string') next.titleContains = input.title_contains;
      if (typeof input.has_email === 'boolean') next.hasEmail = input.has_email;
      if (typeof input.has_linkedin === 'boolean') next.hasLinkedin = input.has_linkedin;
      if (typeof input.has_prospect === 'boolean') next.hasProspect = input.has_prospect;
      if (typeof input.has_deal === 'boolean') next.hasDeal = input.has_deal;
      if (typeof input.last_contacted === 'string') {
        next.lastContacted = input.last_contacted as NetworkFilterState['lastContacted'];
      }
      onApplyFilters(next);
    } else if (tool === 'clear_view') {
      onClearView();
    }
  }

  const STARTERS = [
    'Show me people at Tech companies I haven\'t contacted in 90 days',
    'Highlight my most senior contacts (VP, Director, C-level)',
    'Find warm intros — contacts with email AND LinkedIn but no prospect yet',
    'Reset and show all',
  ];

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Ask Claude to find or filter parts of your network. The graph updates as it answers.
            </p>
            <div className="space-y-1.5">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="w-full text-left text-xs px-3 py-2 rounded border hover:bg-white/5"
                  style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div
              className="inline-block max-w-[90%] rounded px-3 py-2 text-sm whitespace-pre-wrap"
              style={{
                background: m.role === 'user' ? 'var(--accent-glow)' : 'var(--bg-input)',
                color: m.role === 'user' ? 'var(--accent)' : 'var(--text)',
              }}
            >
              {m.content || (busy && i === messages.length - 1 ? '…' : '')}
            </div>
            {m.role === 'assistant' && m.toolResult && (
              <div className="mt-2">
                <ChatResultCard
                  result={m.toolResult}
                  infoByContact={infoByContact}
                  nodes={nodes}
                  onFocusNode={onFocusNode}
                />
              </div>
            )}
          </div>
        ))}

        {error && <p className="text-sm" style={{ color: '#fb7185' }}>{error}</p>}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="p-3 border-t flex gap-2"
        style={{ borderColor: 'var(--border)' }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={busy ? 'Thinking…' : 'Ask: find me people in Tech who…'}
          disabled={busy}
          className="flex-1 px-3 py-2 rounded border text-sm"
          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text)' }}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="px-3 py-2 rounded text-sm font-medium disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#0b1220' }}
        >
          Ask
        </button>
      </form>
    </>
  );
}

function describeToolCall(
  tool: string,
  input: Record<string, unknown>,
  labelByContact: Map<string, string>,
): string | null {
  if (tool === 'highlight_contacts') {
    const ids = (input.contact_ids as string[] | undefined) ?? [];
    const reason = (input.reason as string | undefined) ?? '';
    const names = ids.slice(0, 5).map((id) => labelByContact.get(id) ?? id.slice(0, 8)).join(', ');
    return `Highlighted ${ids.length} contact${ids.length === 1 ? '' : 's'}${names ? ` (${names}${ids.length > 5 ? '…' : ''})` : ''}. ${reason}`.trim();
  }
  if (tool === 'filter_graph') {
    const explanation = (input.explanation as string | undefined) ?? 'Filter applied.';
    return `Filter applied: ${explanation}`;
  }
  if (tool === 'clear_view') {
    return 'Reset to full graph.';
  }
  return null;
}

// ─── Tool result → structured payload ───────────────────────────────────────

function buildToolResult(tool: string, input: Record<string, unknown>): ToolResult | null {
  if (tool === 'highlight_contacts') {
    const ids = Array.isArray(input.contact_ids) ? (input.contact_ids as string[]) : [];
    if (ids.length === 0) return null; // no card for empty highlights
    return {
      tool: 'highlight_contacts',
      contact_ids: ids,
      reason: typeof input.reason === 'string' ? input.reason : '',
    };
  }
  if (tool === 'filter_graph') {
    const c: FilterCriteria = {};
    if (Array.isArray(input.industries)) c.industries = input.industries as string[];
    if (Array.isArray(input.companies)) c.companies = input.companies as string[];
    if (Array.isArray(input.locations)) c.locations = input.locations as string[];
    if (typeof input.title_contains === 'string' && input.title_contains.trim()) c.title_contains = input.title_contains;
    if (typeof input.has_email === 'boolean') c.has_email = input.has_email;
    if (typeof input.has_linkedin === 'boolean') c.has_linkedin = input.has_linkedin;
    if (typeof input.has_prospect === 'boolean') c.has_prospect = input.has_prospect;
    if (typeof input.has_deal === 'boolean') c.has_deal = input.has_deal;
    if (typeof input.last_contacted === 'string') c.last_contacted = input.last_contacted as FilterCriteria['last_contacted'];
    return {
      tool: 'filter_graph',
      criteria: c,
      explanation: typeof input.explanation === 'string' ? input.explanation : 'Filter applied.',
    };
  }
  if (tool === 'clear_view') return { tool: 'clear_view' };
  return null;
}

// ─── Result card UI ─────────────────────────────────────────────────────────

function ChatResultCard({
  result,
  infoByContact,
  nodes,
  onFocusNode,
}: {
  result: ToolResult;
  infoByContact: Map<string, { name: string; title: string | null; company: string | null }>;
  nodes: GraphNode[];
  onFocusNode: (nodeId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (result.tool === 'clear_view') return null;

  if (result.tool === 'highlight_contacts') {
    const ids = result.contact_ids;
    const visibleCount = expanded ? ids.length : Math.min(20, ids.length);
    return (
      <div className="space-y-1.5">
        {ids.slice(0, visibleCount).map((id) => {
          const info = infoByContact.get(id);
          const subtitle = info
            ? [info.title, info.company].filter(Boolean).join(' · ')
            : '';
          return (
            <ItemBtn key={id} onClick={() => onFocusNode(`contact:${id}`)}>
              <strong>{info?.name ?? `Contact …${id.slice(0, 8)}`}</strong>
              {subtitle && (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>
              )}
            </ItemBtn>
          );
        })}
        {ids.length > 20 && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="w-full text-xs px-2 py-1.5 rounded border hover:bg-white/5"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            +{ids.length - 20} more
          </button>
        )}
      </div>
    );
  }

  // filter_graph
  const c = result.criteria;
  const matched = countMatchingContacts(nodes, c);

  return (
    <div className="space-y-2 p-2 rounded border" style={{ borderColor: 'var(--border)' }}>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        <strong style={{ color: 'var(--text)' }}>{matched}</strong>{' '}
        contact{matched === 1 ? '' : 's'} match
      </p>

      {c.industries && c.industries.length > 0 && (
        <ChipRow label="Industry">
          {c.industries.map((ind) => (
            <Chip key={ind} onClick={() => onFocusNode(`industry:${ind}`)}>{ind}</Chip>
          ))}
        </ChipRow>
      )}
      {c.companies && c.companies.length > 0 && (
        <ChipRow label="Company">
          {c.companies.map((co) => <Chip key={co}>{co}</Chip>)}
        </ChipRow>
      )}
      {c.locations && c.locations.length > 0 && (
        <ChipRow label="Location">
          {c.locations.map((loc) => (
            <Chip key={loc} onClick={() => onFocusNode(`location:${loc}`)}>{loc}</Chip>
          ))}
        </ChipRow>
      )}
      {c.title_contains && (
        <ChipRow label="Title contains"><Chip>{c.title_contains}</Chip></ChipRow>
      )}
      {(c.has_email !== undefined || c.has_linkedin !== undefined ||
        c.has_prospect !== undefined || c.has_deal !== undefined) && (
        <ChipRow label="Has">
          {c.has_email !== undefined && <Chip>{c.has_email ? 'email' : 'no email'}</Chip>}
          {c.has_linkedin !== undefined && <Chip>{c.has_linkedin ? 'LinkedIn' : 'no LinkedIn'}</Chip>}
          {c.has_prospect !== undefined && <Chip>{c.has_prospect ? 'prospect' : 'no prospect'}</Chip>}
          {c.has_deal !== undefined && <Chip>{c.has_deal ? 'deal' : 'no deal'}</Chip>}
        </ChipRow>
      )}
      {c.last_contacted && c.last_contacted !== 'any' && (
        <ChipRow label="Last contacted">
          <Chip>{LAST_CONTACTED_LABELS[c.last_contacted]}</Chip>
        </ChipRow>
      )}
    </div>
  );
}

const LAST_CONTACTED_LABELS: Record<NonNullable<FilterCriteria['last_contacted']>, string> = {
  any: 'any',
  never: 'never',
  lt30: 'within 30 days',
  gt30: '>30 days ago',
  gt90: '>90 days ago',
};

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}:</span>
      {children}
    </div>
  );
}

function Chip({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  const isClickable = !!onClick;
  return (
    <button
      onClick={onClick}
      disabled={!isClickable}
      className="text-xs px-2 py-0.5 rounded-full border"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--bg-input)',
        color: 'var(--text)',
        cursor: isClickable ? 'pointer' : 'default',
      }}
    >
      {children}
    </button>
  );
}

// Mirror the structural-filter logic from app/network/page.tsx so the card
// can show a live "N contacts match" count without refactoring that helper
// out of the page module.
function countMatchingContacts(nodes: GraphNode[], c: FilterCriteria): number {
  const titleQ = c.title_contains?.trim().toLowerCase() ?? '';
  let n = 0;
  for (const node of nodes) {
    if (node.type !== 'contact') continue;
    const meta = node.metadata as Record<string, unknown>;
    const industry = (meta.industry as string) ?? null;
    const company = (meta.company as string) ?? null;
    const location = (meta.location as string) ?? null;
    const title = ((meta.title as string) ?? '').toLowerCase();
    const has_email = !!meta.email;
    const has_linkedin = !!meta.linkedin_url;
    const has_prospect = !!meta.prospect_id;
    const has_deal = !!meta.deal_id;
    const last = meta.last_contacted_at as string | null;
    const ageDays = last ? Math.floor((Date.now() - Date.parse(last)) / 86400_000) : null;

    if (c.industries && c.industries.length && (!industry || !c.industries.includes(industry))) continue;
    // companies on the criteria are *names* (Claude's output) — match by company name.
    if (c.companies && c.companies.length && (!company || !c.companies.includes(company))) continue;
    if (c.locations && c.locations.length && (!location || !c.locations.includes(location))) continue;
    if (titleQ && !title.includes(titleQ)) continue;
    if (c.has_email !== undefined && has_email !== c.has_email) continue;
    if (c.has_linkedin !== undefined && has_linkedin !== c.has_linkedin) continue;
    if (c.has_prospect !== undefined && has_prospect !== c.has_prospect) continue;
    if (c.has_deal !== undefined && has_deal !== c.has_deal) continue;
    if (c.last_contacted === 'never' && ageDays !== null) continue;
    if (c.last_contacted === 'lt30' && (ageDays === null || ageDays >= 30)) continue;
    if (c.last_contacted === 'gt30' && (ageDays !== null && ageDays <= 30)) continue;
    if (c.last_contacted === 'gt90' && (ageDays !== null && ageDays <= 90)) continue;
    n++;
  }
  return n;
}

function buildSummary(nodes: GraphNode[], companies: { id: string; name: string }[]) {
  const contactNodes = nodes.filter((n) => n.type === 'contact');
  const accountNodes = nodes.filter((n) => n.type === 'account');
  const industries = Array.from(new Set(nodes.filter((n) => n.type === 'industry').map((n) => n.label))).sort();
  const locations = Array.from(new Set(nodes.filter((n) => n.type === 'location').map((n) => n.label))).sort();

  const sample = contactNodes.slice(0, 400).map((n) => {
    const m = n.metadata as Record<string, unknown>;
    const last = m.last_contacted_at as string | null;
    let last_contacted_days: number | null = null;
    if (last) {
      const t = Date.parse(last);
      if (!Number.isNaN(t)) last_contacted_days = Math.floor((Date.now() - t) / 86400_000);
    }
    return {
      contact_id: m.contact_id as string,
      full_name: (m.full_name as string) ?? null,
      title: (m.title as string) ?? null,
      company: (m.company as string) ?? null,
      industry: (m.industry as string) ?? null,
      location: (m.location as string) ?? null,
      has_email: !!m.email,
      has_linkedin: !!m.linkedin_url,
      has_prospect: !!m.prospect_id,
      has_deal: !!m.deal_id,
      last_contacted_days,
    };
  });

  return {
    contact_count: contactNodes.length,
    account_count: accountNodes.length,
    industries,
    companies: companies.map((c) => c.name).slice(0, 500),
    locations,
    contacts_sample: sample,
  };
}

// ─── One-shot insights panel (existing behavior) ────────────────────────────

function InsightsPanel({ nodes, onFocusNode }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insights, setInsights] = useState<NetworkInsightsResult | null>(null);

  const contactNodes = nodes.filter((n) => n.type === 'contact');
  const labelByContact = new Map<string, string>();
  for (const n of contactNodes) {
    labelByContact.set((n.metadata as { contact_id: string }).contact_id, n.label);
  }

  async function generate() {
    setLoading(true);
    setError(null);
    setInsights(null);
    try {
      const summary = buildOneShotSummary(nodes);
      const res = await fetch('/api/network/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(summary),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setInsights(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {!insights && !loading && (
        <>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Generate a relationship-intelligence report from your current network. Claude analyzes your contacts and surfaces high-value, neglected, and ready-to-act people.
          </p>
          <button
            className="w-full px-3 py-2 rounded text-sm font-medium"
            style={{ background: 'var(--accent)', color: '#0b1220' }}
            onClick={generate}
          >
            Generate insights
          </button>
        </>
      )}

      {loading && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Analyzing network…</p>}
      {error && <p className="text-sm" style={{ color: '#fb7185' }}>{error}</p>}

      {insights && (
        <div className="space-y-4">
          <Section title="High-value contacts" items={insights.high_value_contacts} render={(it) => (
            <ItemBtn onClick={() => onFocusNode(`contact:${it.contact_id}`)}>
              <strong>{labelByContact.get(it.contact_id) ?? it.contact_id}</strong>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{it.reason}</p>
            </ItemBtn>
          )} />
          <Section title="Warm intro paths" items={insights.warm_intro_paths} render={(it) => (
            <ItemBtn onClick={() => onFocusNode(`contact:${it.from_contact_id}`)}>
              <strong>{labelByContact.get(it.from_contact_id) ?? it.from_contact_id}</strong>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>→ {it.to_company}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{it.reason}</p>
            </ItemBtn>
          )} />
          <Section title="Industry clusters with potential" items={insights.industry_clusters_with_potential} render={(it) => (
            <ItemBtn onClick={() => onFocusNode(`industry:${it.industry}`)}>
              <strong>{it.industry}</strong>{' '}
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({it.contact_count} contacts)</span>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{it.action}</p>
            </ItemBtn>
          )} />
          <Section title="Neglected but valuable" items={insights.neglected_but_valuable} render={(it) => (
            <ItemBtn onClick={() => onFocusNode(`contact:${it.contact_id}`)}>
              <strong>{labelByContact.get(it.contact_id) ?? it.contact_id}</strong>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}> · {it.last_contacted_days}d ago</span>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{it.reason}</p>
            </ItemBtn>
          )} />
          <Section title="Best next outreach" items={insights.best_next_outreach} render={(it) => (
            <ItemBtn onClick={() => onFocusNode(`contact:${it.contact_id}`)}>
              <strong>{labelByContact.get(it.contact_id) ?? it.contact_id}</strong>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{it.suggested_message_hook}</p>
            </ItemBtn>
          )} />

          <button
            className="w-full px-3 py-2 rounded text-xs border"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            onClick={() => setInsights(null)}
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

function Section<T>({ title, items, render }: { title: string; items?: T[]; render: (item: T) => React.ReactNode }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{title}</h3>
      <div className="space-y-2">
        {items.map((it, i) => <div key={i}>{render(it)}</div>)}
      </div>
    </div>
  );
}

function ItemBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-2 py-2 rounded border text-sm hover:bg-white/5"
      style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
    >
      {children}
    </button>
  );
}

// One-shot insights endpoint expects a slightly different summary shape.
function buildOneShotSummary(nodes: GraphNode[]) {
  const contacts = nodes.filter((n) => n.type === 'contact');
  const accounts = nodes.filter((n) => n.type === 'account');

  const industryCount = new Map<string, number>();
  const companyCount = new Map<string, number>();
  const locationCount = new Map<string, number>();
  for (const n of contacts) {
    const meta = n.metadata as Record<string, unknown>;
    const industry = (meta.industry as string) ?? null;
    const company = (meta.company as string) ?? null;
    const location = (meta.location as string) ?? null;
    if (industry) industryCount.set(industry, (industryCount.get(industry) ?? 0) + 1);
    if (company) companyCount.set(company, (companyCount.get(company) ?? 0) + 1);
    if (location) locationCount.set(location, (locationCount.get(location) ?? 0) + 1);
  }

  const top_industries = topN(industryCount, 5).map(([industry, contact_count]) => ({ industry, contact_count }));
  const top_companies = topN(companyCount, 5).map(([company, contact_count]) => ({ company, contact_count }));
  const top_locations = topN(locationCount, 5).map(([location, contact_count]) => ({ location, contact_count }));

  const now = Date.now();
  let neglected_count = 0;
  let warm_but_cold_count = 0;

  const sample = contacts.slice(0, 200).map((n) => {
    const meta = n.metadata as Record<string, unknown>;
    const last = meta.last_contacted_at as string | null;
    let last_contacted_days: number | null = null;
    if (last) {
      const t = Date.parse(last);
      if (!Number.isNaN(t)) last_contacted_days = Math.floor((now - t) / 86400_000);
    }
    if (last_contacted_days === null || last_contacted_days >= 90) neglected_count++;
    const has_email = !!meta.email;
    const has_linkedin = !!meta.linkedin_url;
    const has_prospect = !!meta.prospect_id;
    const has_deal = !!meta.deal_id;
    if (has_linkedin && !has_email) warm_but_cold_count++;
    return {
      contact_id: meta.contact_id as string,
      full_name: (meta.full_name as string) ?? null,
      title: (meta.title as string) ?? null,
      company: (meta.company as string) ?? null,
      industry: (meta.industry as string) ?? null,
      has_email, has_linkedin, has_prospect, has_deal,
      last_contacted_days,
    };
  });

  return {
    contact_count: contacts.length,
    account_count: accounts.length,
    top_industries,
    top_companies,
    top_locations,
    neglected_count,
    warm_but_cold_count,
    contacts_sample: sample,
  };
}

function topN<K>(m: Map<K, number>, n: number): [K, number][] {
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);
}
