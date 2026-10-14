'use client';

import { useCallback, useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import LeadRow from '@/components/sales-leads/LeadRow';
import LeadDetail from '@/components/sales-leads/LeadDetail';
import type { Lead, LeadCounts, LeadSort, LeadView, TeamUser } from '@/lib/sales-leads';

/**
 * /sales-leads — the team's lead dashboard. One line per lead, ranked by the
 * priority people set; expand for the dossier, the track record and the
 * controls. Views: Working (open leads), Due (ping-by reached or quiet 14+
 * days), Must talk, then the status tabs. Search narrows by name / company /
 * title / where met; "Mine" keeps the leads where I am back or front office.
 */
const VIEWS: { key: LeadView; label: string; hint: string }[] = [
  { key: 'working', label: 'Working', hint: 'open leads, best first' },
  { key: 'due', label: 'Due', hint: 'ping-by date reached, or quiet 14+ days' },
  { key: 'must', label: '★ Must talk', hint: 'starred' },
  { key: 'new', label: 'New', hint: 'not handled yet' },
  { key: 'contacted', label: 'Contacted', hint: 'we messaged (replied included)' },
  { key: 'replied', label: 'Replied', hint: 'they answered' },
  { key: 'converted', label: 'Converted', hint: 'became a deal' },
  { key: 'archived', label: 'Archived', hint: 'not pursuing' },
  { key: 'all', label: 'All', hint: 'everything' },
];

export default function SalesLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [counts, setCounts] = useState<LeadCounts | null>(null);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [view, setView] = useState<LeadView>('working');
  const [sort, setSort] = useState<LeadSort>('priority');
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ view, sort });
      if (q.trim()) params.set('q', q.trim());
      if (mine) params.set('mine', '1');
      const res = await fetch(`/api/sales-leads?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setLeads(data.leads || []);
      setCounts(data.counts || null);
      setUsers(data.users || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [view, sort, q, mine]);

  useEffect(() => { const t = setTimeout(() => load(), q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2200); }

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    setBusyId(id);
    try {
      const res = await fetch(`/api/sales-leads/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      if (!('notes' in body)) await load(true);
      return true;
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Update failed');
      return false;
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
      window.location.href = `/deals/${data.deal_id}`;
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Convert failed');
      setBusyId(null);
    }
  }

  function toggle(id: string) {
    setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  const chip = (active: boolean) => ({
    background: active ? 'var(--accent)' : 'var(--bg-input)',
    color: active ? 'var(--accent-fg)' : 'var(--text-muted)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
  });

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-lg font-bold">Sales leads</h1>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Everyone we are working: demo requests, event contacts, replies to our outreach. Priority 1 is the top of the list; the ticker is days since we last talked.
              </p>
            </div>
            {counts && (
              <div className="flex gap-1.5 flex-wrap">
                {([
                  ['working', 'working', 'var(--text)'], ['due', 'due', 'var(--red)'], ['must', 'must talk', 'var(--orange)'],
                  ['replied', 'replied', 'var(--cat-teal)'], ['converted', 'converted', 'var(--green)'], ['booked', 'demos booked', 'var(--green)'],
                ] as [keyof LeadCounts, string, string][]).map(([k, label, color]) => (
                  <button key={k} type="button" disabled={k === 'booked'} onClick={() => setView(k as LeadView)}
                    className="rounded-lg px-3 py-1.5 text-left min-w-[84px] disabled:cursor-default"
                    style={{ background: 'var(--bg-card)', border: `1px solid ${view === k ? color : 'var(--border)'}` }}>
                    <div className="text-lg font-bold leading-tight tabular-nums" style={{ color }}>{counts[k]}</div>
                    <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sticky controls */}
        <div className="sticky top-0 z-10 px-4 py-2 flex flex-wrap gap-2 items-center" style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, title, where met…"
            className="text-sm rounded-lg px-3 py-1.5 flex-1 min-w-[200px]" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
          <div className="flex gap-1 flex-wrap">
            {VIEWS.map((v) => (
              <button key={v.key} type="button" onClick={() => setView(v.key)} title={v.hint}
                className="px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap" style={chip(view === v.key)}>
                {v.label}{counts && v.key in counts ? <span className="ml-1 opacity-75">{counts[v.key as keyof LeadCounts]}</span> : null}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setMine(!mine)} className="px-2.5 py-1 rounded-full text-xs font-medium" style={chip(mine)} title="leads where I am back or front office">Mine</button>
          <select value={sort} onChange={(e) => setSort(e.target.value as LeadSort)} className="text-xs rounded-lg px-2 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            <option value="priority">Sort: priority</option>
            <option value="contact">Sort: longest since contact</option>
            <option value="newest">Sort: newest</option>
          </select>
        </div>

        <div className="p-4">
          {error && (
            <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>{error}</div>
          )}
          <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
            {loading ? 'Loading…' : `${leads.length} shown · ${leads.filter((l) => l.priority).length} ranked · ${leads.filter((l) => l.must_talk).length} starred`}
          </div>

          {!loading && leads.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {view === 'due' ? 'Nobody is due. Set a “ping again on” date on a lead to see it here.'
                  : view === 'must' ? 'Nobody starred yet. Click ☆ on a lead.'
                  : q ? `No lead matches “${q}”.` : `No ${view} leads.`}
              </p>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              {leads.map((l, i) => (
                <div key={l.id} style={{ borderTop: i ? '1px solid var(--border)' : undefined, background: open.has(l.id) ? 'color-mix(in srgb, var(--accent) 4%, transparent)' : undefined }}>
                  <LeadRow lead={l} rank={i + 1} open={open.has(l.id)} onToggle={() => toggle(l.id)} busy={busyId === l.id}
                    onPatch={(p) => { patch(l.id, p); }} />
                  {open.has(l.id) && (
                    <LeadDetail lead={l} users={users} busy={busyId === l.id} onPatch={(p) => patch(l.id, p)} onConvert={() => convert(l.id)} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {toast && (
          <div className="fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm z-20" style={{ background: 'var(--text)', color: 'var(--bg)' }}>{toast}</div>
        )}
      </div>
    </div>
  );
}
