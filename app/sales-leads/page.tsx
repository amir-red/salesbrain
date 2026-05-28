'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';

interface SalesLead {
  id: string;
  full_name: string;
  company: string;
  email: string;
  description: string | null;
  source: string;
  status: 'new' | 'contacted' | 'converted' | 'archived';
  created_at: string;
  converted_at: string | null;
  converted_deal_id: string | null;
  converted_deal_name: string | null;
  converted_deal_gate: number | null;
}

type StatusFilter = 'new' | 'contacted' | 'converted' | 'archived' | 'all';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'converted', label: 'Converted' },
  { key: 'archived', label: 'Archived' },
  { key: 'all', label: 'All' },
];

const statusColor: Record<SalesLead['status'], string> = {
  new: 'var(--accent)',
  contacted: '#eab308',
  converted: 'var(--green)',
  archived: 'var(--text-muted)',
};

export default function SalesLeadsPage() {
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('new');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales-leads?status=${filter}`);
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load');
      const data = await res.json();
      setLeads(data.leads || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(id: string, status: 'contacted' | 'archived' | 'new') {
    setBusyId(id);
    try {
      const res = await fetch(`/api/sales-leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Update failed');
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  }

  async function convert(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/sales-leads/${id}/convert`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Convert failed');
      // Hop straight into the new deal — they'll want to triage in chat.
      window.location.href = `/deals/${data.deal_id}`;
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Convert failed');
      setBusyId(null);
    }
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold">Sales Leads</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Demo-request submissions from zeami.io and other intake forms. Convert promising ones to a sales deal at G1.
          </p>
        </div>

        <div className="p-4">
          {/* Filter chips */}
          <div className="flex gap-2 mb-4">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: filter === f.key ? 'var(--accent)' : 'var(--bg-input)',
                  color: filter === f.key ? '#fff' : 'var(--text-muted)',
                  border: `1px solid ${filter === f.key ? 'var(--accent)' : 'var(--border)'}`,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}>
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          ) : leads.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {filter === 'new'
                  ? 'No new leads. Submissions to zeami.io\'s demo form will show up here.'
                  : `No ${filter} leads.`}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {leads.map((l) => (
                <div
                  key={l.id}
                  className="rounded-lg p-4"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderLeft: `3px solid ${statusColor[l.status]}` }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold truncate">{l.full_name}</h3>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>·</span>
                        <span className="text-xs font-medium truncate" style={{ color: 'var(--text)' }}>{l.company}</span>
                        <span
                          className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold"
                          style={{ background: `${statusColor[l.status]}20`, color: statusColor[l.status] }}
                        >
                          {l.status}
                        </span>
                      </div>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                        <a href={`mailto:${l.email}`} className="hover:underline">{l.email}</a>
                        <span> · {l.source} · {new Date(l.created_at).toLocaleString()}</span>
                      </p>
                      {l.description && (
                        <p className="text-xs mt-2 whitespace-pre-wrap" style={{ color: 'var(--text)' }}>
                          {l.description}
                        </p>
                      )}
                      {l.converted_deal_id && (
                        <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                          → Converted to{' '}
                          <Link href={`/deals/${l.converted_deal_id}`} className="hover:underline" style={{ color: 'var(--accent)' }}>
                            {l.converted_deal_name || 'deal'} (G{l.converted_deal_gate ?? '?'})
                          </Link>
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      {l.status !== 'converted' && (
                        <button
                          onClick={() => convert(l.id)}
                          disabled={busyId === l.id}
                          className="px-3 py-1.5 rounded text-xs font-medium text-white disabled:opacity-50"
                          style={{ background: 'var(--accent)' }}
                        >
                          {busyId === l.id ? '…' : 'Convert to deal'}
                        </button>
                      )}
                      {l.status === 'new' && (
                        <button
                          onClick={() => setStatus(l.id, 'contacted')}
                          disabled={busyId === l.id}
                          className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
                        >
                          Mark contacted
                        </button>
                      )}
                      {l.status !== 'archived' && l.status !== 'converted' && (
                        <button
                          onClick={() => setStatus(l.id, 'archived')}
                          disabled={busyId === l.id}
                          className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                        >
                          Archive
                        </button>
                      )}
                      {l.status === 'archived' && (
                        <button
                          onClick={() => setStatus(l.id, 'new')}
                          disabled={busyId === l.id}
                          className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
