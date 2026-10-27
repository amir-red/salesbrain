'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import IcpWizard from '@/components/icp/IcpWizard';
import ListFunnelCard, { AllListsCard } from '@/components/icp/ListFunnelCard';
import type { RunMode } from '@/components/icp/IcpRow';
import type { IcpProfile } from '@/lib/icp';
import { EMPTY_ICP_FILTER, applyIcpFilters } from '@/lib/icp-panel';
import type { FleetPayload, IcpListFilter, OverviewPayload } from '@/lib/icp-panel';
import { usePoll } from '@/lib/use-poll';
import { relativeTime } from '@/lib/time';

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; profile: IcpProfile };

/**
 * /icp — the lists overview as funnels (design E, 2026-10-27): a summary card for all lists, then one card per
 * list with its own small funnel, step conversions and conversion rate; actions sit behind each card's menu. Each card opens /icp/[id].
 * The agent fleet strip moved off this page (it lives on /agents). Polls every 45 s while visible.
 */
export default function IcpPage() {
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [fleet, setFleet] = useState<FleetPayload | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [busy, setBusy] = useState<string | null>(null);
  const [estate, setEstate] = useState(true);        // every teammate's lists (visible to everyone); off = mine only
  const [filter, setFilter] = useState<IcpListFilter>(EMPTY_ICP_FILTER);
  const [sort, setSort] = useState<'contacted' | 'conversion' | 'found'>('contacted');

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetch(`/api/icp/overview${estate ? '?scope=all' : ''}`), fetch('/api/agents')]);
    if (!a.ok) throw new Error('Failed to load ICPs');
    setOverview(await a.json());
    if (b.ok) setFleet(await b.json());
  }, [estate]);
  const { refresh, loading, lastAt, error } = usePoll(load, 45_000);

  const setState = async (p: IcpProfile, state: 'running' | 'paused') => {
    let reason: string | undefined;
    if (state === 'paused') {
      const answer = prompt(`Pause "${p.name}"?\n\nSourcing, enrichment, drafting and sending stop for this ICP only. Its leads and history are untouched, and Resume puts it straight back.\n\nReason (optional):`);
      if (answer === null) return;
      reason = answer.trim() || undefined;
    }
    setBusy(p.id);
    try {
      const res = await fetch(`/api/icp/${p.id}/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, reason }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) alert(json.error || 'Could not change the state');
      await refresh();
    } finally { setBusy(null); }
  };
  const archive = async (p: IcpProfile) => {
    if (!confirm(`Archive "${p.name}"? Its prospects keep their link; re-creating the same name revives it.`)) return;
    setBusy(p.id);
    try {
      const res = await fetch(`/api/icp/${p.id}`, { method: 'DELETE' });
      if (res.ok) await refresh();
    } finally { setBusy(null); }
  };
  const runAgent = (p: IcpProfile) => async (m: RunMode) => {
    const res = await fetch(`/api/icp/${p.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: m }) });
    const out = await res.json().catch(() => ({}));
    void refresh();
    return out as Record<string, unknown>;
  };

  const icps = overview?.icps ?? [];
  const shown = applyIcpFilters(icps, filter, overview?.holds_by_owner ?? {});
  const isAdmin = Boolean(overview?.is_admin);
  const viewer = overview?.viewer_user_id ?? '';
  const fleetFlags = {
    kill_switch: fleet?.kill_switch ?? true,
    leads_finder_enabled: fleet?.agents.find((a) => a.name === 'leads_finder')?.enabled ?? true,
  };

  const sorted = [...shown].sort((a, b) => {
    const fa = a.funnel, fb = b.funnel;
    const ea = !fa || fa.found === 0, eb = !fb || fb.found === 0;
    if (ea !== eb) return ea ? 1 : -1;                       // lists with nobody on them go last
    if (sort === 'conversion') {
      // contacted → opportunity first; with no opportunities yet, the deepest step still separates lists
      const key = (f: typeof fa) => (f && f.contacted
        ? [f.opportunity / f.contacted, f.meeting / f.contacted, f.answered / f.contacted] : [-1, -1, -1]);
      const ka = key(fa), kb = key(fb);
      for (let i = 0; i < 3; i++) if (kb[i] !== ka[i]) return kb[i] - ka[i];
    }
    if (sort === 'found') return (fb?.found ?? 0) - (fa?.found ?? 0);
    return (fb?.contacted ?? 0) - (fa?.contacted ?? 0) || (fb?.found ?? 0) - (fa?.found ?? 0);
  });
  const withPeople = icps.filter((i) => (i.funnel?.found ?? 0) > 0).length;
  const total = overview?.funnel_total ?? null;
  const inputStyle = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        {(mode.kind === 'new' || mode.kind === 'edit') && (
          <>
            <div className="px-8 pt-6 pb-4 flex items-center gap-3">
              <button onClick={() => setMode({ kind: 'list' })} className="text-sm" style={{ color: 'var(--text-muted)' }}>← Lists</button>
              <h1 className="text-2xl font-semibold">{mode.kind === 'new' ? 'New list' : `Edit · ${mode.profile.name}`}</h1>
            </div>
            <IcpWizard
              initial={mode.kind === 'edit' ? mode.profile : null}
              onSaved={() => { setMode({ kind: 'list' }); void refresh(); }}
              onCancel={() => setMode({ kind: 'list' })}
            />
          </>
        )}

        {mode.kind === 'list' && (
          <div className="px-8 py-7 space-y-6 max-w-[1280px]">
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-[32px] font-semibold tracking-tight leading-tight">Lists</h1>
                <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                  {icps.length} {icps.length === 1 ? 'list' : 'lists'}
                  {overview && <> · {withPeople} with people · {icps.length - withPeople} not started</>}
                  {lastAt && <> · <button onClick={() => refresh()} className="hover:underline" title="Refresh">updated {relativeTime(lastAt.toISOString())}</button></>}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Link href="/agents" className="text-sm px-3 py-2 rounded-full hover:underline" style={{ color: 'var(--text-muted)' }}>Agents</Link>
                <div role="group" aria-label="Whose lists" className="flex gap-1 p-1 rounded-full" style={{ background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>
                  {([[true, 'Everyone'], [false, 'Mine']] as const).map(([v, label]) => (
                    <button key={label} aria-pressed={estate === v} onClick={() => { setEstate(v); setFilter((f) => ({ ...f, owner: 'all' })); }}
                            className="px-3.5 py-1.5 rounded-full text-sm font-medium"
                            style={{ background: estate === v ? 'var(--bg-card)' : 'transparent', color: estate === v ? 'var(--text)' : 'var(--text-muted)' }}>
                      {label}
                    </button>
                  ))}
                </div>
                <button onClick={() => setMode({ kind: 'new' })} className="h-10 px-5 rounded-full text-sm font-medium"
                        style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                  New list
                </button>
              </div>
            </header>

            {error && <div className="rounded-xl px-3 py-2 text-sm" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>Could not refresh ({error}){overview ? '. Showing the last numbers.' : '.'}</div>}

            {icps.length > 3 && (
              <div className="flex flex-wrap items-center gap-2">
                <input value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} placeholder="Search lists or owners"
                       aria-label="Search lists" className="h-10 px-4 rounded-full text-sm w-72 outline-none" style={inputStyle} />
                <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort lists"
                        className="h-10 px-3 rounded-full text-sm outline-none" style={inputStyle}>
                  <option value="contacted">Most contacted</option>
                  <option value="conversion">Best conversion</option>
                  <option value="found">Most people</option>
                </select>
              </div>
            )}

            {loading && !overview && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>}
            {overview && icps.length === 0 && (
              <div className="text-center py-16 space-y-3" style={{ color: 'var(--text-muted)' }}>
                <p className="text-base">No lists yet.</p>
                <button onClick={() => setMode({ kind: 'new' })} className="h-10 px-5 rounded-full text-sm font-medium" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                  Create your first list
                </button>
              </div>
            )}
            {overview && icps.length > 0 && shown.length === 0 && (
              <p className="text-sm py-10 text-center" style={{ color: 'var(--text-muted)' }}>No list matches “{filter.q}”.</p>
            )}

            {overview && shown.length > 0 && (
              <section aria-label="Lists" className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
                {total && !filter.q && <AllListsCard f={total} lists={withPeople} />}
                {sorted.map((p) => (
                  <ListFunnelCard key={p.id} icp={p} quota={overview?.quota_by_owner[p.owner_user_id] ?? null} viewerUserId={viewer} isAdmin={isAdmin}
                                  fleet={fleetFlags} hold={overview?.holds_by_owner?.[p.owner_user_id]?.leads_finder ?? null} busy={busy === p.id}
                                  onRun={runAgent(p)} onState={(st) => setState(p, st)} onArchive={() => archive(p)} />
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
