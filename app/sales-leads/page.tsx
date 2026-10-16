'use client';

import { useCallback, useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import LeadRow, { ROW_GRID } from '@/components/sales-leads/LeadRow';
import LeadDetail from '@/components/sales-leads/LeadDetail';
import { Search } from '@/components/sales-leads/icons';
import { type Lead, type LeadCounts, type LeadSort, type LeadStatus, type LeadView, type RoleFilter, type TeamUser } from '@/lib/sales-leads';
import ExportButton from '@/components/ExportButton';

/**
 * /sales-leads — the team's lead dashboard. One aligned line per lead, ranked
 * by the priority people set; expand for the briefing, the track record and
 * the controls. Three working views (Working / Due / Must talk) plus a status
 * filter; search narrows by name, company, title or where met; "Mine" keeps
 * the leads I work — in either seat, as back office (I drive them) or as
 * front office (I take the calls). Back / front office are responsibilities
 * (core 058): the digest, replies, bookings and convert all follow them.
 */
const WORK_VIEWS: { key: LeadView; label: string; hint: string }[] = [
  { key: 'working', label: 'Working', hint: 'Open leads, best first' },
  { key: 'due', label: 'Due', hint: 'Ping-by date reached, or quiet for 14+ days (starred, high-priority or already-contacted leads)' },
  { key: 'must', label: 'Must talk', hint: 'Starred' },
];
const STATUS_VIEWS: { key: LeadStatus | 'all'; label: string }[] = [
  { key: 'new', label: 'New' }, { key: 'contacted', label: 'Contacted' }, { key: 'replied', label: 'Replied' },
  { key: 'converted', label: 'Converted' }, { key: 'archived', label: 'Archived' }, { key: 'all', label: 'Everything' },
];

export default function SalesLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [counts, setCounts] = useState<LeadCounts | null>(null);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [view, setView] = useState<LeadView>('working');
  const [sort, setSort] = useState<LeadSort>('priority');
  const [q, setQ] = useState('');
  const [role, setRole] = useState<RoleFilter>('');   // '' everyone · any = mine · responsible / front = mine in that seat
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false);
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
      if (role) { params.set('mine', '1'); if (role !== 'any') params.set('role', role); }
      const res = await fetch(`/api/sales-leads?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setLeads(data.leads || []);
      setCounts(data.counts || null);
      setUsers(data.users || []);
      setViewerId(data.viewer_id || null);
      setViewerIsAdmin(!!data.viewer_is_admin);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [view, sort, q, role]);

  // Deep links from the digest / chat: /sales-leads?view=due&mine=1[&role=responsible]
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get('view') as LeadView | null;
    if (v && (WORK_VIEWS.some((w) => w.key === v) || STATUS_VIEWS.some((w) => w.key === v))) setView(v);
    if (sp.get('mine') === '1') setRole(sp.get('role') === 'responsible' ? 'responsible' : sp.get('role') === 'front' ? 'front' : 'any');
  }, []);

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

  const isStatusView = !WORK_VIEWS.some((v) => v.key === view);
  const seg = (active: boolean) => ({
    background: active ? 'var(--bg-card)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--text-muted)',
    boxShadow: active ? 'var(--shadow-card)' : 'none',
  });
  const METRICS: { key: LeadView; label: string; color?: string }[] = [
    { key: 'working', label: 'Working' }, { key: 'due', label: 'Due', color: 'var(--red)' }, { key: 'must', label: 'Must talk', color: 'var(--orange)' },
    { key: 'replied', label: 'Replied', color: 'var(--cat-teal)' }, { key: 'converted', label: 'Converted', color: 'var(--green)' },
  ];

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1400px] mx-auto px-6 pt-6 pb-10">
          {/* ── Header ───────────────────────────────────────────── */}
          <div className="flex flex-wrap items-end justify-between gap-6 mb-6">
            <div>
              <div className="z-eyebrow mb-1">Pipeline</div>
              <h1 className="text-2xl font-semibold tracking-tight">Sales leads</h1>
              <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
                Everyone we are working, best first. The counter is days since we last talked.
              </p>
            </div>
            <div className="flex">
              {METRICS.map((m, i) => (
                <button key={m.key} type="button" onClick={() => setView(m.key)} title={`Show ${m.label.toLowerCase()}`}
                  className="text-left py-1 pr-5 pl-5 first:pl-0 rounded-lg" style={{ borderLeft: i ? '1px solid var(--border)' : undefined, opacity: view === m.key ? 1 : 0.85 }}>
                  <div className="text-xl font-semibold tabular-nums leading-tight" style={{ color: m.color ?? 'var(--text)' }}>{counts ? counts[m.key as keyof LeadCounts] : '–'}</div>
                  <div className="z-eyebrow">{m.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* ── Toolbar ──────────────────────────────────────────── */}
          <div className="sticky top-0 z-10 -mx-6 px-6 py-3 flex flex-wrap items-center gap-3" style={{ background: 'var(--bg)' }}>
            <div className="inline-flex p-1 rounded-full" style={{ background: 'var(--bg-input)' }}>
              {WORK_VIEWS.map((v) => (
                <button key={v.key} type="button" onClick={() => setView(v.key)} title={v.hint}
                  className="px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors" style={seg(view === v.key)}>
                  {v.label}{counts ? <span className="ml-1.5 text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{counts[v.key as keyof LeadCounts]}</span> : null}
                </button>
              ))}
            </div>
            <select value={isStatusView ? view : ''} onChange={(e) => e.target.value && setView(e.target.value as LeadView)} aria-label="Filter by status"
              className="text-sm rounded-full px-3 py-1.5" style={{ background: isStatusView ? 'var(--bg-card)' : 'transparent', border: '1px solid var(--border)', color: isStatusView ? 'var(--text)' : 'var(--text-muted)' }}>
              <option value="">By status…</option>
              {STATUS_VIEWS.map((s) => <option key={s.key} value={s.key}>{s.label}{counts ? ` (${counts[s.key]})` : ''}</option>)}
            </select>
            <select value={role} onChange={(e) => setRole(e.target.value as RoleFilter)} aria-label="Whose leads"
              title="Mine = leads where I sit in either seat; back office = I drive them; front office = I take the calls"
              className="text-sm rounded-full px-3 py-1.5" style={{ background: role ? 'var(--accent)' : 'transparent', color: role ? 'var(--accent-fg)' : 'var(--text-muted)', border: `1px solid ${role ? 'var(--accent)' : 'var(--border)'}` }}>
              <option value="">Everyone</option>
              <option value="any">Mine</option>
              <option value="responsible">Mine · back office</option>
              <option value="front">Mine · front office</option>
            </select>
            <div className="flex-1" />
            <label className="relative">
              <Search width={15} height={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads" aria-label="Search"
                className="text-sm rounded-full pl-9 pr-4 py-1.5 w-56 focus:w-72 transition-[width]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            </label>
            <select value={sort} onChange={(e) => setSort(e.target.value as LeadSort)} aria-label="Sort"
              className="text-sm rounded-full px-3 py-1.5" style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              <option value="priority">Priority</option>
              <option value="contact">Longest since contact</option>
              <option value="newest">Newest</option>
            </select>
            <ExportButton
              href={`/api/export/sales-leads?${new URLSearchParams({ view, sort, ...(q ? { q } : {}), ...(role ? { mine: '1', ...(role !== 'any' ? { role } : {}) } : {}) })}`}
              title="Download what this list shows (current view, search and Mine filter) as Excel, with every track-record line" />
          </div>

          {/* ── List ─────────────────────────────────────────────── */}
          {error && (
            <div className="rounded-xl p-4 mb-4 text-sm flex items-center justify-between gap-3" style={{ background: 'color-mix(in srgb, var(--red) 8%, transparent)', color: 'var(--red)' }}>
              <span>{error}</span>
              <button type="button" className="underline" onClick={() => load()}>Try again</button>
            </div>
          )}

          <div className="z-card overflow-hidden mt-2">
            <div className={`hidden md:grid ${ROW_GRID} gap-x-3 px-4 py-2 z-eyebrow`} style={{ borderBottom: '1px solid var(--border)' }}>
              <span>#</span><span title="Order inside the priority (1 = first)">Order</span><span>Lead</span><span>Status</span><span>Last contact</span><span>Works it</span><span>Priority</span>
              <span className="text-right">{loading ? '' : `${leads.length} shown`}</span>
            </div>
            {loading ? (
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="px-4 py-3 flex items-center gap-3" style={{ borderTop: i ? '1px solid var(--border)' : undefined }}>
                    <div className="w-6 h-3 rounded animate-pulse" style={{ background: 'var(--bg-input)' }} />
                    <div className="flex-1 space-y-1.5"><div className="h-3.5 w-48 rounded animate-pulse" style={{ background: 'var(--bg-input)' }} /><div className="h-3 w-72 rounded animate-pulse" style={{ background: 'var(--bg-input)' }} /></div>
                  </div>
                ))}
              </div>
            ) : leads.length === 0 ? (
              <div className="py-16 text-center space-y-2">
                <p className="text-sm font-medium">
                  {view === 'due' ? 'Nobody is due.' : view === 'must' ? 'Nobody starred yet.' : q ? `No lead matches “${q}”.` : 'No leads here.'}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {view === 'due' ? 'Set a “ping again on” date on a lead and it will show up here when it is time.'
                    : view === 'must' ? 'Star the people you must talk to with the star on each row.'
                    : role ? 'Nothing in that seat. Assign yourself as back or front office on a lead and it shows up here.'
                    : q ? 'Try a shorter search, or switch to Everything.' : 'Demo requests, event contacts and replies to outreach land here.'}
                </p>
              </div>
            ) : (
              leads.map((l, i) => (
                <div key={l.id} style={{ borderTop: i ? '1px solid var(--border)' : undefined }}>
                  <LeadRow lead={l} rank={i + 1} open={open.has(l.id)} viewerId={viewerId} onToggle={() => toggle(l.id)} busy={busyId === l.id} onPatch={(p) => { patch(l.id, p); }} />
                  {open.has(l.id) && (
                    <LeadDetail lead={l} users={users} viewerId={viewerId} viewerIsAdmin={viewerIsAdmin} busy={busyId === l.id} onPatch={(p) => patch(l.id, p)} onConvert={() => convert(l.id)} onRefresh={() => load(true)} />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-sm z-20" style={{ background: 'var(--text)', color: 'var(--bg)', boxShadow: 'var(--shadow-card)' }}>{toast}</div>
        )}
      </div>
    </div>
  );
}
