'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import { relativeTime } from '@/lib/time';

interface Client {
  company: string;
  deal_count: number;
  max_deal_value: string | null;
  highest_gate_reached: number;
  best_score: number | null;
  last_activity: string;
  currency: string;
}

function ScorePill({ score }: { score: number | null }) {
  if (score === null) return <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>N/A</span>;
  const color = score >= 70 ? 'var(--green)' : score >= 40 ? 'var(--yellow)' : 'var(--red)';
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: `${color}20`, color }}>
      {score}
    </span>
  );
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/clients');
        if (res.ok) setClients(await res.json());
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  const filtered = search
    ? clients.filter((c) => c.company.toLowerCase().includes(search.toLowerCase()))
    : clients;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="text-lg font-bold">Clients</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{clients.length} companies</p>
          </div>
          <a
            href="/deals/new"
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            + New client / deal
          </a>
        </div>

        {/* Search */}
        <div className="p-4 pb-0">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients..."
            className="w-full max-w-md px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
          />
        </div>

        {/* Grid */}
        <div className="p-4">
          {loading && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</p>}

          {!loading && filtered.length === 0 && (
            <div className="text-center py-12">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" className="mx-auto mb-3">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
              </svg>
              <p style={{ color: 'var(--text-muted)' }}>
                {search ? 'No clients match your search' : 'No clients yet'}
              </p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            {filtered.map((c) => (
              <div
                key={c.company}
                className="rounded-xl p-4"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-medium">{c.company}</h3>
                  </div>
                  <ScorePill score={c.best_score} />
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Deals</p>
                    <p className="text-sm font-medium">{c.deal_count}</p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Best gate</p>
                    <p className="text-sm font-medium">G{c.highest_gate_reached}</p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Max value</p>
                    <p className="text-sm font-medium">
                      {c.max_deal_value ? `${c.currency} ${Number(c.max_deal_value).toLocaleString()}` : '-'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    Last active {relativeTime(c.last_activity)}
                  </p>
                  <a
                    href={`/pipeline?client=${encodeURIComponent(c.company)}`}
                    className="text-[10px] font-medium"
                    style={{ color: 'var(--accent)' }}
                  >
                    View deals
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
