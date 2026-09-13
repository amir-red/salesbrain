'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import IcpBuilder from '@/components/icp/IcpBuilder';
import LeadsTable from '@/components/icp/LeadsTable';
import { ActivityList } from '@/components/icp/IcpLeads';
import type { RunMode } from '@/components/icp/IcpRow';
import DefinitionSection from '@/components/icp/panel/DefinitionSection';
import FinderSection from '@/components/icp/panel/FinderSection';
import EnricherSection from '@/components/icp/panel/EnricherSection';
import GraphSection from '@/components/icp/panel/GraphSection';
import OutreachSection from '@/components/icp/panel/OutreachSection';
import SectionCard from '@/components/panel/SectionCard';
import FunnelBar from '@/components/panel/FunnelBar';
import type { PanelPayload } from '@/lib/icp-panel';
import { usePoll } from '@/lib/use-poll';
import { relativeTime } from '@/lib/time';

/**
 * /icp/[id] — the control panel for one ICP: the lead's journey, section by
 * section (definition → finder → enricher → graph & routes → outreach), with
 * the machinery's state beside each step, then the list and the activity feed.
 * Polls every 30 s; actions reuse the endpoints the old cards already had.
 */
export default function IcpPanelPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<PanelPayload | null>(null);
  const [status, setStatus] = useState<number>(200);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<RunMode | 'state' | 'archive' | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/icp/${id}/panel`);
    setStatus(res.status);
    if (!res.ok) throw new Error(res.status === 404 ? 'Not found, or not yours' : 'Failed to load');
    setData(await res.json());
    setTick((t) => t + 1);
  }, [id]);
  const { refresh, loading, lastAt, error } = usePoll(load, 30_000);

  const run = async (mode: RunMode) => {
    setBusy(mode); setNote(null);
    try {
      const res = await fetch(`/api/icp/${id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
      const out = await res.json().catch(() => ({}));
      if (out?.error) setNote(String(out.error));
      else if (mode === 'now') setNote(`Analyzed ${out?.analyzed ?? 0} · matched ${out?.matched ?? 0} · new ${out?.new ?? 0} · researched ${out?.researched ?? 0}${out?.more_pages ? ' · more pages remain' : ''}`);
      else setNote(String(out?.note || 'Queued for the next tick.'));
      await refresh();
    } finally { setBusy(null); }
  };
  const setState = async (state: 'running' | 'paused') => {
    if (!data) return;
    let reason: string | undefined;
    if (state === 'paused') {
      const answer = prompt(`Pause "${data.icp.name}"?\n\nSourcing, enrichment, drafting and sending stop for this ICP only. Resume puts it straight back.\n\nReason (optional):`);
      if (answer === null) return;
      reason = answer.trim() || undefined;
    }
    setBusy('state');
    try {
      const res = await fetch(`/api/icp/${id}/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, reason }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) alert(json.error || 'Could not change the state');
      await refresh();
    } finally { setBusy(null); }
  };
  const archive = async () => {
    if (!data || !confirm(`Archive "${data.icp.name}"? Its prospects keep their link; re-creating the same name revives it.`)) return;
    setBusy('archive');
    try {
      const res = await fetch(`/api/icp/${id}`, { method: 'DELETE' });
      if (res.ok) router.push('/icp');
    } finally { setBusy(null); }
  };

  const canAct = Boolean(data?.is_owner) && (data?.blockers.length ?? 0) === 0;
  const disabledReason = data && !data.is_owner ? 'Runs with the owner’s LinkedIn — only the owner can start it' : data?.blockers[0];
  const runBusy = busy === 'now' || busy === 'queue' || busy === 'enrich' ? busy : null;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b flex items-start justify-between gap-4 sticky top-0 z-10" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
          <div className="min-w-0">
            <h1 className="text-lg font-bold flex items-center gap-2">
              <Link href="/icp" className="text-sm" style={{ color: 'var(--text-muted)' }} title="All ICPs">←</Link>
              <span className="truncate">{data?.icp.name ?? (loading ? 'Loading…' : 'ICP')}</span>
              {data?.icp.paused_at && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>⏸ paused</span>}
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {data ? <>{data.is_owner ? 'Your ICP' : `${data.icp.owner_name}’s ICP`} · {lastAt ? `updated ${relativeTime(lastAt.toISOString())}` : ''} · <button onClick={() => refresh()} className="underline">refresh</button></> : 'The whole journey for this list, and what the machinery is doing at each step.'}
            </p>
          </div>
          {data && !editing && (
            <div className="flex flex-wrap gap-2 justify-end shrink-0">
              {data.icp.paused_at
                ? <button onClick={() => setState('running')} disabled={busy === 'state'} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }}>Resume</button>
                : <button onClick={() => setState('paused')} disabled={busy === 'state'} className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }} title="Hold this ICP only — reversible">Pause</button>}
              {data.is_owner && <button onClick={() => setEditing(true)} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>Edit</button>}
              {data.is_owner && <button onClick={archive} disabled={busy === 'archive'} className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40" style={{ color: 'var(--text-muted)' }}>Archive</button>}
            </div>
          )}
        </div>

        {error && !data && (
          <div className="p-8 text-center text-sm space-y-2" style={{ color: 'var(--text-muted)' }}>
            <p>{status === 404 ? 'This ICP does not exist, or it is not yours to see.' : error}</p>
            <Link href="/icp" className="underline">Back to ICPs</Link>
          </div>
        )}
        {error && data && <div className="mx-4 mt-3 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}>Last refresh failed ({error}); showing the previous data.</div>}

        {data && editing && (
          <IcpBuilder initial={data.icp} onSaved={() => { setEditing(false); void refresh(); }} onCancel={() => setEditing(false)} />
        )}

        {data && !editing && (
          <div className="p-4 space-y-4">
            {data.blockers.length > 0 && (
              <div className="rounded-xl px-4 py-3 text-xs space-y-0.5" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid var(--yellow)' }}>
                <div className="font-medium" style={{ color: 'var(--yellow)' }}>The Leads Finder will not run for this ICP right now</div>
                {data.blockers.map((b, i) => <div key={i} style={{ color: 'var(--text-muted)' }}>· {b}</div>)}
              </div>
            )}
            {note && <div className="text-[11px]" style={{ color: note.toLowerCase().includes('error') || note.startsWith('Leads Finder can') ? 'var(--red)' : 'var(--text-muted)' }}>{note}</div>}

            <SectionCard title="2 · The list" subtitle={`${data.coverage.total} leads · ${data.coverage.matched} matched · ${data.coverage.engaged} engaged · ${data.coverage.deals} became deals`}>
              <FunnelBar stages={data.stages} legend height={12} />
            </SectionCard>

            <div className="grid gap-4 xl:grid-cols-2">
              <DefinitionSection data={data} onEdit={data.is_owner ? () => setEditing(true) : undefined} />
              <FinderSection data={data} canAct={canAct} busy={runBusy} onRun={run} disabledReason={disabledReason} />
              <EnricherSection data={data} canAct={canAct} busy={runBusy} onRun={run} disabledReason={disabledReason} />
              <GraphSection data={data} onChanged={refresh} />
            </div>
            <div id="outreach"><OutreachSection data={data} onChanged={refresh} /></div>

            <SectionCard title="Leads" subtitle="best fit first · coverage: E employer · R research · @ email · 🔥 warm angle · ↝ warm route">
              <LeadsTable icpId={id} tick={tick} />
            </SectionCard>

            <SectionCard title="Activity" subtitle="every agent tick that touched this ICP, plus the owner's enricher and graph syncs and the outreach routine">
              <ActivityList runs={data.activity} showIcp />
            </SectionCard>
          </div>
        )}
      </div>
    </div>
  );
}
