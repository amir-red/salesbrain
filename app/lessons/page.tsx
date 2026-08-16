'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';

interface Lesson {
  id: string;
  deal_id: string;
  deal_type: 'sales' | 'grant' | 'ai_credit';
  gate_lost_at: number;
  value: string | null;
  currency: string | null;
  company: string;
  reason: string;
  root_cause: RootCause;
  competitor: string | null;
  lesson: string;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  deal_name: string | null;
  deal_status: 'active' | 'lost';
}

type RootCause =
  | 'price' | 'timeline' | 'fit' | 'decision_maker' | 'capability'
  | 'competition' | 'budget' | 'eligibility' | 'other';

type DealTypeFilter = 'all' | 'sales' | 'grant' | 'ai_credit';

const ROOT_CAUSE_LABEL: Record<RootCause, string> = {
  price: 'Price',
  timeline: 'Timeline',
  fit: 'Fit',
  decision_maker: 'Decision-maker',
  capability: 'Capability',
  competition: 'Competition',
  budget: 'Budget',
  eligibility: 'Eligibility',
  other: 'Other',
};

const ROOT_CAUSE_COLOR: Record<RootCause, string> = {
  price: '#ef4444',
  timeline: '#f59e0b',
  fit: '#a78bfa',
  decision_maker: '#3b82f6',
  capability: '#06b6d4',
  competition: '#ec4899',
  budget: '#eab308',
  eligibility: '#8b5cf6',
  other: '#94a3b8',
};

export default function LessonsPage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dealTypeFilter, setDealTypeFilter] = useState<DealTypeFilter>('all');
  const [rootCauseFilter, setRootCauseFilter] = useState<RootCause | 'all'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (dealTypeFilter !== 'all') params.set('deal_type', dealTypeFilter);
      if (rootCauseFilter !== 'all') params.set('root_cause', rootCauseFilter);
      const res = await fetch(`/api/lessons${params.toString() ? '?' + params : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setLessons(data.lessons || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [dealTypeFilter, rootCauseFilter]);

  useEffect(() => { load(); }, [load]);

  async function deleteLesson(id: string) {
    if (!confirm('Delete this lesson? The deal stays marked lost.')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/lessons/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  // Aggregate counts for the header summary
  const total = lessons.length;
  const byRootCause = lessons.reduce<Record<string, number>>((acc, l) => {
    acc[l.root_cause] = (acc[l.root_cause] || 0) + 1;
    return acc;
  }, {});
  const topRootCause = Object.entries(byRootCause).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold">Lessons Learned</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Every deal we marked lost lands here with a structured root cause and a takeaway.
            The agent loads the top 3 relevant lessons into chat when a similar new deal opens —
            so we proactively avoid the same mistake.
          </p>
          {total > 0 && topRootCause && (
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text)' }}>{total}</strong> lesson{total === 1 ? '' : 's'} ·
              top root cause: <strong style={{ color: ROOT_CAUSE_COLOR[topRootCause[0] as RootCause] }}>
                {ROOT_CAUSE_LABEL[topRootCause[0] as RootCause]}
              </strong> ({topRootCause[1]})
            </p>
          )}
        </div>

        <div className="p-4">
          {/* Filters */}
          <div className="flex gap-2 mb-4 flex-wrap items-center">
            <FilterChip active={dealTypeFilter === 'all'} onClick={() => setDealTypeFilter('all')}>All</FilterChip>
            <FilterChip active={dealTypeFilter === 'sales'} onClick={() => setDealTypeFilter('sales')}>Sales</FilterChip>
            <FilterChip active={dealTypeFilter === 'grant'} onClick={() => setDealTypeFilter('grant')}>Grants</FilterChip>
            <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>Root cause:</span>
            <select
              value={rootCauseFilter}
              onChange={(e) => setRootCauseFilter(e.target.value as RootCause | 'all')}
              className="px-2 py-1 rounded text-xs"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
            >
              <option value="all">all</option>
              {(Object.keys(ROOT_CAUSE_LABEL) as RootCause[]).map((rc) => (
                <option key={rc} value={rc}>{ROOT_CAUSE_LABEL[rc]}</option>
              ))}
            </select>
          </div>

          {error && (
            <div className="rounded p-3 mb-4 text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          ) : lessons.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                No lessons yet{(dealTypeFilter !== 'all' || rootCauseFilter !== 'all') ? ' matching these filters' : ''}.
                When you mark a deal lost, the structured lesson lands here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {lessons.map((l) => (
                <article
                  key={l.id}
                  className="rounded-lg p-4"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderLeft: `3px solid ${ROOT_CAUSE_COLOR[l.root_cause]}`,
                  }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      {/* Header row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/deals/${l.deal_id}`}
                          className="text-sm font-semibold truncate hover:underline"
                          style={{ color: 'var(--text)' }}
                        >
                          {l.company}
                        </Link>
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold"
                              style={{ background: l.deal_type === 'grant' ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.15)',
                                       color: l.deal_type === 'grant' ? '#22c55e' : '#3b82f6' }}>
                          {l.deal_type === 'grant' ? 'GRANT' : 'SALES'}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold"
                              style={{ background: `${ROOT_CAUSE_COLOR[l.root_cause]}20`, color: ROOT_CAUSE_COLOR[l.root_cause] }}>
                          {ROOT_CAUSE_LABEL[l.root_cause]}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          G{l.gate_lost_at}
                          {l.value && Number(l.value) > 0 && (
                            <> · {l.currency || 'USD'} {Math.round(Number(l.value)).toLocaleString()}</>
                          )}
                          {l.competitor && <> · lost to {l.competitor}</>}
                        </span>
                      </div>

                      {/* Reason */}
                      <p className="text-xs mt-2 whitespace-pre-wrap" style={{ color: 'var(--text)' }}>
                        <span className="font-semibold" style={{ color: 'var(--text-muted)' }}>Why we lost: </span>
                        {l.reason}
                      </p>

                      {/* The lesson — the takeaway */}
                      <div
                        className="mt-2 p-2 rounded text-xs"
                        style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', color: 'var(--text)' }}
                      >
                        <span className="font-semibold" style={{ color: '#22c55e' }}>Lesson: </span>
                        {l.lesson}
                      </div>

                      <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
                        Captured by {l.created_by_name || 'unknown'} on {new Date(l.created_at).toLocaleDateString()}
                      </p>
                    </div>

                    <button
                      onClick={() => deleteLesson(l.id)}
                      disabled={busyId === l.id}
                      className="px-2 py-1 rounded text-[10px] disabled:opacity-50"
                      style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                      title="Delete this lesson (deal stays marked lost)"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
      style={{
        background: active ? 'var(--accent)' : 'var(--bg-input)',
        color: active ? '#fff' : 'var(--text-muted)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      }}
    >
      {children}
    </button>
  );
}
