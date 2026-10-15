'use client';

import { useMemo, useState } from 'react';
import type { GraphNode } from '@/lib/network-graph';

/**
 * The default /network view since 2026-10-15: a table of contact nodes.
 * The cytoscape canvas is drawn only on request ("Show graph") — with
 * thousands of nodes the force layout took longer than reading the list.
 * Search, filters and AI highlights apply here exactly as on the canvas
 * (`hiddenNodeIds` is computed once by the page).
 */

type SortKey = 'name' | 'company' | 'title' | 'industry' | 'location' | 'owner' | 'last';

interface Props {
  nodes: GraphNode[];
  hiddenNodeIds: Set<string>;
  searchTerm: string;
  selectedNodeId: string | null;
  onNodeSelect: (id: string) => void;
}

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }

function ago(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return '';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export default function NetworkList({ nodes, hiddenNodeIds, searchTerm, selectedNodeId, onNodeSelect }: Props) {
  const [sort, setSort] = useState<SortKey>('name');
  const [desc, setDesc] = useState(false);
  const [limit, setLimit] = useState(200);

  const rows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const out = nodes.filter((n) => n.type === 'contact' && !hiddenNodeIds.has(n.id)).filter((n) => {
      if (!term) return true;
      const m = n.metadata;
      return [n.label, str(m.title), str(m.company), str(m.industry), str(m.location), str(m.email), str(m.owner)]
        .some((x) => x.toLowerCase().includes(term));
    });
    const key = (n: GraphNode): string => {
      const m = n.metadata;
      switch (sort) {
        case 'company': return str(m.company);
        case 'title': return str(m.title);
        case 'industry': return str(m.industry);
        case 'location': return str(m.location);
        case 'owner': return str(m.owner);
        case 'last': return str(m.last_contacted_at);
        default: return n.label;
      }
    };
    out.sort((a, b) => {
      const ka = key(a), kb = key(b);
      if (!ka && kb) return 1;
      if (ka && !kb) return -1;
      const c = ka.localeCompare(kb, undefined, { sensitivity: 'base' });
      return desc ? -c : c;
    });
    return out;
  }, [nodes, hiddenNodeIds, searchTerm, sort, desc]);

  const head = (k: SortKey, label: string, cls = '') => (
    <th
      className={`px-3 py-2 text-left font-medium cursor-pointer select-none ${cls}`}
      style={{ color: sort === k ? 'var(--text)' : 'var(--text-muted)' }}
      onClick={() => { if (sort === k) setDesc((d) => !d); else { setSort(k); setDesc(false); } }}
    >
      {label}{sort === k ? (desc ? ' ▾' : ' ▴') : ''}
    </th>
  );

  return (
    <div className="absolute inset-0 overflow-auto">
      <table className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead className="sticky top-0 z-10" style={{ background: 'var(--bg)' }}>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {head('name', 'Name')}
            {head('title', 'Title')}
            {head('company', 'Company')}
            {head('industry', 'Industry', 'hidden xl:table-cell')}
            {head('location', 'Location', 'hidden lg:table-cell')}
            {head('owner', 'Held by')}
            <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Reach</th>
            {head('last', 'Last contact', 'text-right')}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((n) => {
            const m = n.metadata;
            const selected = n.id === selectedNodeId;
            return (
              <tr
                key={n.id}
                onClick={() => onNodeSelect(n.id)}
                className="cursor-pointer"
                style={{
                  background: selected ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : undefined,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <td className="px-3 py-1.5" style={{ color: 'var(--text)', borderBottom: '1px solid var(--border)' }}>
                  {n.label}
                  {str(m.prospect_stage) && (
                    <span className="ml-2 rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>
                      {str(m.prospect_stage).replace(/^P\d_/, '').toLowerCase().replace(/_/g, ' ')}
                    </span>
                  )}
                  {m.deal_gate != null && (
                    <span className="ml-1 rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                      G{String(m.deal_gate)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>{str(m.title)}</td>
                <td className="px-3 py-1.5" style={{ color: 'var(--text)', borderBottom: '1px solid var(--border)' }}>{str(m.company)}</td>
                <td className="px-3 py-1.5 hidden xl:table-cell" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>{str(m.industry)}</td>
                <td className="px-3 py-1.5 hidden lg:table-cell" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>{str(m.location)}</td>
                <td className="px-3 py-1.5" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>{str(m.owner) || '—'}</td>
                <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                  {[m.email ? 'email' : null, m.linkedin_url ? 'linkedin' : null, m.phone ? 'phone' : null].filter(Boolean).join(' · ')}
                </td>
                <td className="px-3 py-1.5 text-right" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>{ago(m.last_contacted_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-3 px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span>{rows.length.toLocaleString()} people{rows.length > limit ? `, showing ${limit}` : ''}</span>
        {rows.length > limit && (
          <button onClick={() => setLimit((l) => l + 500)} className="rounded px-2 py-1" style={{ background: 'var(--bg-input)', color: 'var(--text)' }}>
            Show more
          </button>
        )}
        {rows.length === 0 && <span>Nothing matches the current search / filters.</span>}
      </div>
    </div>
  );
}
