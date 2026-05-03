'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Sidebar from '@/components/Sidebar';
import NetworkFilters, { EMPTY_FILTERS, type NetworkFilterState } from '@/components/NetworkFilters';
import NetworkDetailPanel from '@/components/NetworkDetailPanel';
import NetworkInsights from '@/components/NetworkInsights';
import type { GraphNode, GraphEdge } from '@/lib/network-graph';

// Cytoscape is a heavy library — load it only on this page
const NetworkGraph = dynamic(() => import('@/components/NetworkGraph'), { ssr: false });

type LayoutKey = 'industry' | 'company' | 'location' | 'lead_stage' | 'relationship';

interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    industries: string[];
    locations: string[];
    companies: { id: string; name: string }[];
    contact_count: number;
    account_count: number;
  };
}

export default function NetworkPage() {
  const [data, setData] = useState<GraphPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutKey>('industry');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<NetworkFilterState>(EMPTY_FILTERS);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  // AI-highlighted contact UUIDs (set by Claude tool calls in the chat panel).
  // When non-empty, the graph dims everything that isn't in this set or
  // structurally connected to it.
  const [aiHighlightIds, setAiHighlightIds] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/network');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        if (searchRef.current) {
          e.preventDefault();
          searchRef.current.focus();
        }
      }
      if (!(e.metaKey || e.ctrlKey || e.altKey) && document.activeElement?.tagName !== 'INPUT') {
        if (e.key === '1') setLayout('industry');
        else if (e.key === '2') setLayout('company');
        else if (e.key === '3') setLayout('location');
        else if (e.key === '4') setLayout('lead_stage');
        else if (e.key === '5') setLayout('relationship');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hiddenNodeIds = useMemo(() => {
    if (!data) return new Set<string>();
    return computeHidden(data.nodes, filters, aiHighlightIds);
  }, [data, filters, aiHighlightIds]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !data) return null;
    return data.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [selectedNodeId, data]);

  if (isMobile) {
    return (
      <div className="flex h-screen" style={{ background: 'var(--bg)' }}>
        <Sidebar />
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div>
            <p style={{ color: 'var(--text)' }}>Network view works best on desktop.</p>
            <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
              <a href="/clients" style={{ color: 'var(--accent)' }}>Open contacts list →</a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg)' }}>
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center gap-3 p-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && data && search.trim()) {
                const term = search.trim().toLowerCase();
                const match = data.nodes.find((n) =>
                  n.label.toLowerCase().includes(term) && !hiddenNodeIds.has(n.id)
                );
                if (match) setSelectedNodeId(match.id);
              }
            }}
            placeholder="Search name, title, company, industry…  (⌘F)"
            className="px-3 py-1.5 rounded border text-sm w-72"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />

          <select
            value={layout}
            onChange={(e) => setLayout(e.target.value as LayoutKey)}
            className="px-3 py-1.5 rounded border text-sm"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            <option value="industry">Industry cluster (1)</option>
            <option value="company">Company cluster (2)</option>
            <option value="location">Location cluster (3)</option>
            <option value="lead_stage">Lead stage (4)</option>
            <option value="relationship">Relationship strength (5)</option>
          </select>

          <div className="flex-1" />

          {data && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {data.meta.contact_count} contacts · {data.meta.account_count} accounts
            </span>
          )}

          {data && (
            <NetworkFilters
              filters={filters}
              onChange={setFilters}
              industries={data.meta.industries}
              locations={data.meta.locations}
              companies={data.meta.companies}
            />
          )}

          {(aiHighlightIds.size > 0 || hiddenNodeIds.size > 0) && (
            <button
              onClick={() => { setAiHighlightIds(new Set()); setFilters(EMPTY_FILTERS); }}
              className="px-3 py-1.5 rounded text-xs border"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              title="Clear all filters and AI highlights"
            >
              Reset view
            </button>
          )}

          <button
            onClick={() => setInsightsOpen(true)}
            className="px-3 py-1.5 rounded text-sm font-medium"
            style={{ background: 'var(--accent)', color: '#0b1220' }}
          >
            AI Insights
          </button>
        </header>

        {/* Graph area */}
        <div className="flex-1 relative overflow-hidden">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
              Loading network…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ color: '#fb7185' }}>
              {error}
            </div>
          )}
          {!loading && data && data.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-center">
              <div>
                <p style={{ color: 'var(--text)' }}>No contacts yet.</p>
                <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
                  Import from LinkedIn or Google to get started.{' '}
                  <a href="/integrations" style={{ color: 'var(--accent)' }}>Open integrations →</a>
                </p>
              </div>
            </div>
          )}
          {!loading && data && data.nodes.length > 0 && (
            <NetworkGraph
              nodes={data.nodes}
              edges={data.edges}
              layout={layout}
              searchTerm={search}
              hiddenNodeIds={hiddenNodeIds}
              selectedNodeId={selectedNodeId}
              onNodeSelect={setSelectedNodeId}
            />
          )}

          {/* Right panels (insights takes priority) */}
          {insightsOpen && data && (
            <NetworkInsights
              open={insightsOpen}
              onClose={() => setInsightsOpen(false)}
              nodes={data.nodes}
              companies={data.meta.companies}
              onFocusNode={(id) => { setSelectedNodeId(id); }}
              onApplyFilters={(next) => {
                // Filters and AI highlights are independent layers — applying
                // a filter from the chat clears any prior AI highlight so the
                // user sees a clean structural filter.
                setAiHighlightIds(new Set());
                setFilters(next);
              }}
              onHighlightContacts={(ids) => {
                // AI highlight wins; clear structural filters so the user
                // sees exactly the contacts Claude picked.
                setFilters(EMPTY_FILTERS);
                setAiHighlightIds(new Set(ids));
              }}
              onClearView={() => {
                setFilters(EMPTY_FILTERS);
                setAiHighlightIds(new Set());
              }}
            />
          )}
          {!insightsOpen && selectedNode && (
            <NetworkDetailPanel
              node={selectedNode}
              onClose={() => setSelectedNodeId(null)}
              onUpdate={load}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Filter logic (client-side) ─────────────────────────────────────────────
function computeHidden(
  nodes: GraphNode[],
  f: NetworkFilterState,
  aiHighlightIds: Set<string>,
): Set<string> {
  const hidden = new Set<string>();
  const aiActive = aiHighlightIds.size > 0;

  // First pass: hide contacts that don't match
  const visibleAccountIds = new Set<string>();
  const visibleIndustries = new Set<string>();
  const visibleLocations = new Set<string>();

  for (const n of nodes) {
    if (n.type !== 'contact') continue;
    const meta = n.metadata as Record<string, unknown>;
    const contactId = (meta.contact_id as string) ?? null;
    const industry = (meta.industry as string) ?? null;
    const accountId = (meta.account_id as string) ?? null;
    const location = (meta.location as string) ?? null;
    const title = ((meta.title as string) ?? '').toLowerCase();
    const has_email = !!meta.email;
    const has_phone = !!meta.phone;
    const has_linkedin = !!meta.linkedin_url;
    const has_prospect = !!meta.prospect_id;
    const has_deal = !!meta.deal_id;
    const last = meta.last_contacted_at as string | null;
    const ageDays = last ? Math.floor((Date.now() - Date.parse(last)) / 86400_000) : null;

    let visible = true;
    // AI highlight wins: hide everything that isn't in the highlighted set.
    if (aiActive && (!contactId || !aiHighlightIds.has(contactId))) visible = false;
    if (f.industries.length && (!industry || !f.industries.includes(industry))) visible = false;
    if (f.companies.length && (!accountId || !f.companies.includes(accountId))) visible = false;
    if (f.locations.length && (!location || !f.locations.includes(location))) visible = false;
    if (f.titleContains.trim() && !title.includes(f.titleContains.trim().toLowerCase())) visible = false;
    if (f.hasEmail !== null && has_email !== f.hasEmail) visible = false;
    if (f.hasPhone !== null && has_phone !== f.hasPhone) visible = false;
    if (f.hasLinkedin !== null && has_linkedin !== f.hasLinkedin) visible = false;
    if (f.hasProspect !== null && has_prospect !== f.hasProspect) visible = false;
    if (f.hasDeal !== null && has_deal !== f.hasDeal) visible = false;
    if (f.lastContacted === 'never' && ageDays !== null) visible = false;
    if (f.lastContacted === 'lt30' && (ageDays === null || ageDays >= 30)) visible = false;
    if (f.lastContacted === 'gt30' && (ageDays !== null && ageDays <= 30)) visible = false;
    if (f.lastContacted === 'gt90' && (ageDays !== null && ageDays <= 90)) visible = false;

    if (!visible) hidden.add(n.id);
    else {
      if (accountId) visibleAccountIds.add(accountId);
      if (industry) visibleIndustries.add(industry);
      if (location) visibleLocations.add(location);
    }
  }

  // Hide accounts/industries/locations that no visible contact connects to
  for (const n of nodes) {
    if (n.type === 'account') {
      const id = (n.metadata as { account_id: string }).account_id;
      if (!visibleAccountIds.has(id)) hidden.add(n.id);
    } else if (n.type === 'industry') {
      const ind = (n.metadata as { industry: string }).industry;
      if (!visibleIndustries.has(ind)) hidden.add(n.id);
    } else if (n.type === 'location') {
      const loc = (n.metadata as { location: string }).location;
      if (!visibleLocations.has(loc)) hidden.add(n.id);
    }
  }

  return hidden;
}
