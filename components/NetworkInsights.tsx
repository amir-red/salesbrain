'use client';

import { useState } from 'react';
import type { GraphNode } from '@/lib/network-graph';

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
}

export default function NetworkInsights({ open, onClose, nodes, onFocusNode }: Props) {
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
      const summary = buildSummary(nodes);
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

  if (!open) return null;

  return (
    <aside
      className="absolute top-0 right-0 h-full w-[420px] flex flex-col border-l overflow-y-auto z-20"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
    >
      <header className="flex items-center justify-between p-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>AI Network Insights</h2>
        <button onClick={onClose} className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
      </header>

      <div className="p-4 space-y-3">
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
                <strong>{it.industry}</strong> <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({it.contact_count} contacts)</span>
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
              onClick={() => { setInsights(null); }}
            >
              Reset
            </button>
          </div>
        )}
      </div>
    </aside>
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

// ─── Build the compact summary the API expects ───────────────────────────────
function buildSummary(nodes: GraphNode[]) {
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
