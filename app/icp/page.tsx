'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import IcpBuilder from '@/components/icp/IcpBuilder';
import FleetStrip from '@/components/icp/FleetStrip';
import IcpRow from '@/components/icp/IcpRow';
import type { RunMode } from '@/components/icp/IcpRow';
import type { IcpProfile } from '@/lib/icp';
import type { FleetPayload, OverviewPayload } from '@/lib/icp-panel';
import { usePoll } from '@/lib/use-poll';
import { relativeTime } from '@/lib/time';

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; profile: IcpProfile };

/**
 * /icp — the control panel's overview: the agent fleet at a glance, then one
 * row per ICP with its funnel, coverage, run state and actions. Each row opens
 * /icp/[id], the per-ICP drill-down. Polls every 45 s while visible.
 */
export default function IcpPage() {
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [fleet, setFleet] = useState<FleetPayload | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [busy, setBusy] = useState<string | null>(null);
  const [estate, setEstate] = useState(false);       // admin: every employee's ICPs

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
  const isAdmin = Boolean(overview?.is_admin);
  const viewer = overview?.viewer_user_id ?? '';
  const myQuota = overview?.quota_by_owner[viewer] ?? null;
  const fleetFlags = {
    kill_switch: fleet?.kill_switch ?? true,
    leads_finder_enabled: fleet?.agents.find((a) => a.name === 'leads_finder')?.enabled ?? true,
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              {mode.kind !== 'list' && (
                <button onClick={() => setMode({ kind: 'list' })} className="text-sm" style={{ color: 'var(--text-muted)' }} title="Back">←</button>
              )}
              {mode.kind === 'list' ? 'Ideal Customer Profiles' : mode.kind === 'new' ? 'New ICP' : `Edit · ${mode.profile.name}`}
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {mode.kind === 'list'
                ? <>{icps.length} active · who to look for, and what every agent is doing about it{lastAt && <> · updated {relativeTime(lastAt.toISOString())} · <button onClick={() => refresh()} className="underline">refresh</button></>}</>
                : 'Every prospect sourced or imported is scored against this profile, with reasons.'}
            </p>
          </div>
          {mode.kind === 'list' && (
            <div className="flex items-center gap-3">
              <Link href="/prospecting" className="text-xs underline" style={{ color: 'var(--text-muted)' }}>Prospects →</Link>
              {isAdmin && (
                <button onClick={() => setEstate((v) => !v)} className="px-3 py-1.5 rounded-lg text-xs"
                        style={{ border: '1px solid var(--border)', background: estate ? 'var(--accent)' : 'transparent', color: estate ? '#fff' : 'var(--text-muted)' }}
                        title="Admin: every employee's ICPs, including those filed by the partner app">
                  {estate ? 'All employees' : 'Mine only'}
                </button>
              )}
              <button onClick={() => setMode({ kind: 'new' })} className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: '#fff' }}>
                + New ICP
              </button>
            </div>
          )}
        </div>

        {(mode.kind === 'new' || mode.kind === 'edit') && (
          <IcpBuilder
            initial={mode.kind === 'edit' ? mode.profile : null}
            onSaved={() => { setMode({ kind: 'list' }); void refresh(); }}
            onCancel={() => setMode({ kind: 'list' })}
          />
        )}

        {mode.kind === 'list' && (
          <div className="p-4 space-y-4">
            {error && <div className="rounded-lg px-3 py-2 text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}>Last refresh failed ({error}){overview ? '; showing the previous data.' : '.'}</div>}
            <FleetStrip fleet={fleet} quota={myQuota} onChanged={refresh} />
            {loading && !overview && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>}
            {overview && icps.length === 0 && (
              <div className="text-center py-16 space-y-2" style={{ color: 'var(--text-muted)' }}>
                <p className="text-sm">No ICP yet.</p>
                <p className="text-xs">Describe who you sell to — or paste your website and let AI draft the first one.</p>
                <button onClick={() => setMode({ kind: 'new' })} className="mt-2 px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: '#fff' }}>
                  Create your first ICP
                </button>
              </div>
            )}
            <div className="space-y-3">
              {icps.map((p) => (
                <IcpRow key={p.id} icp={p} quota={overview?.quota_by_owner[p.owner_user_id] ?? null} viewerUserId={viewer} isAdmin={isAdmin}
                        fleet={fleetFlags} busy={busy === p.id}
                        onRun={runAgent(p)} onState={(s) => setState(p, s)} onArchive={() => archive(p)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
