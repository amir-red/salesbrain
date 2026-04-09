'use client';

import { useState } from 'react';

interface Deal {
  id: string;
  name: string;
  company: string;
  gate: number;
  score: number | null;
  risk: string | null;
  value: string | null;
  currency: string;
  owner: string | null;
  gate_entered_at: string;
  days_in_gate: number;
  sla_days: number;
  is_overdue: boolean;
  is_board: boolean;
}

interface Gate {
  number: number;
  name: string;
  color: string;
  deals: Deal[];
}

const FILTERS = ['All', 'My deals', 'Overdue', 'Board pending'] as const;

function DealCard({ deal }: { deal: Deal }) {
  const slaRatio = deal.days_in_gate / deal.sla_days;
  const badgeColor = slaRatio >= 1 ? 'var(--red)' : slaRatio >= 0.7 ? 'var(--yellow)' : 'var(--green)';

  return (
    <a
      href={`/deals/${deal.id}`}
      className="block rounded-lg p-3 mb-2 transition-colors"
      style={{
        background: 'var(--bg-input)',
        border: '1px solid var(--border)',
        borderLeft: deal.is_overdue ? '3px solid var(--red)' : '3px solid transparent',
      }}
    >
      <p className="text-sm font-medium truncate">{deal.name}</p>
      <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{deal.company}</p>
      <div className="flex items-center justify-between mt-2">
        {deal.value && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {deal.currency} {Number(deal.value).toLocaleString()}
          </span>
        )}
        {deal.is_board ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(109,40,217,0.2)', color: '#a78bfa' }}>
            Board
          </span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${badgeColor}20`, color: badgeColor }}>
            {deal.days_in_gate}d / {deal.sla_days}d
          </span>
        )}
      </div>
      {deal.owner && (
        <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{deal.owner}</p>
      )}
    </a>
  );
}

export default function FilterBar({ gates }: { gates: Gate[] }) {
  const [filter, setFilter] = useState<typeof FILTERS[number]>('All');

  const filteredGates = gates.map((g) => ({
    ...g,
    deals: g.deals.filter((d) => {
      if (filter === 'All') return true;
      if (filter === 'My deals') return d.owner !== null;
      if (filter === 'Overdue') return d.is_overdue;
      if (filter === 'Board pending') return d.is_board;
      return true;
    }),
  }));

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: filter === f ? 'var(--accent)' : 'var(--bg-input)',
              color: filter === f ? '#fff' : 'var(--text-muted)',
              border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`,
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Kanban columns */}
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 140px)' }}>
        {filteredGates.map((g) => (
          <div key={g.number} className="flex-shrink-0 w-56 flex flex-col">
            {/* Column header */}
            <div
              className="rounded-t-lg px-3 py-2 flex items-center justify-between"
              style={{ background: g.color }}
            >
              <span className="text-xs font-medium text-white">G{g.number}: {g.name}</span>
              <span className="text-[10px] bg-white/20 text-white px-1.5 py-0.5 rounded-full">
                {g.deals.length}
              </span>
            </div>
            {/* Cards */}
            <div
              className="flex-1 p-2 rounded-b-lg overflow-y-auto"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderTop: 'none' }}
            >
              {g.deals.length === 0 && (
                <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>No deals</p>
              )}
              {g.deals.map((d) => (
                <DealCard key={d.id} deal={d} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
